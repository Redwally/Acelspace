import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const backupDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backups');
const backupPattern = /^backup-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite$/;
let activeBackup = null;

function getTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function retainRecentBackups() {
    const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
    const backups = await Promise.all(entries
        .filter(entry => entry.isFile() && backupPattern.test(entry.name))
        .map(async entry => ({
            filename: entry.name,
            modifiedAt: (await fs.stat(path.join(backupDirectory, entry.name))).mtimeMs
        })));
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expired = backups.filter(backup => backup.modifiedAt < cutoff);
    await Promise.all(expired.map(backup => fs.unlink(path.join(backupDirectory, backup.filename))));
    const retained = backups
        .filter(backup => backup.modifiedAt >= cutoff)
        .sort((a, b) => b.modifiedAt - a.modifiedAt);

    await Promise.all(retained.slice(30).map(backup => fs.unlink(path.join(backupDirectory, backup.filename))));
}

async function notifyDiscord(filename) {
    if (!process.env.DISCORD_WEBHOOK_URL) return;
    try {
        const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `Sauvegarde SQLite créée : ${filename}` }),
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`Webhook Discord HTTP ${response.status}`);
    } catch (error) {
        console.error('Échec de la notification Discord de sauvegarde :', error);
    }
}

export async function runBackup(db, beforeBackup) {
    if (activeBackup) return activeBackup;
    activeBackup = (async () => {
        beforeBackup?.();
        await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
        await fs.chmod(backupDirectory, 0o700);
        const filename = `backup-${getTimestamp()}.sqlite`;
        const target = path.join(backupDirectory, filename);
        const temporary = path.join(backupDirectory, `.${filename}.${crypto.randomUUID()}.tmp`);
        try {
            await db.backup(temporary);
            await fs.chmod(temporary, 0o600);
            await fs.rename(temporary, target);
            await retainRecentBackups();
            console.log(`Sauvegarde SQLite créée : ${target}`);
            await notifyDiscord(filename);
            return target;
        } catch (error) {
            try {
                await fs.unlink(temporary);
            } catch (cleanupError) {
                if (cleanupError.code !== 'ENOENT') {
                    console.error('Échec du nettoyage de la sauvegarde temporaire :', cleanupError);
                }
            }
            throw error;
        }
    })();

    try {
        return await activeBackup;
    } finally {
        activeBackup = null;
    }
}

export function scheduleBackups(db, beforeBackup) {
    runBackup(db, beforeBackup).catch(error => console.error('Échec de la sauvegarde SQLite initiale :', error));
    cron.schedule('0 0 * * *', () => {
        runBackup(db, beforeBackup).catch(error => console.error('Échec de la sauvegarde SQLite planifiée :', error));
    });
}
