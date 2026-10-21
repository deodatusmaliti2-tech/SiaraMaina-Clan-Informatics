const REPOSITORY = (process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '') : null) || 'deodatusmaliti2-tech/SiaraMaina-Clan-Informatics';
const BRANCH = process.env.GITHUB_BRANCH || 'Main';
const DATA_PATH = 'siara-maina-clan-data.json';
const USERS_PATH = 'siara-maina-clan-users.json';

function githubUrl(path) {
    return `https://api.github.com/repos/${REPOSITORY}/contents/${path}`;
}

function githubHeaders() {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
    };
}

function encodeContent(value) {
    return Buffer.from(JSON.stringify(value, null, 2), 'utf8').toString('base64');
}

async function readGithubFile(path) {
    const response = await fetch(githubUrl(path), { headers: githubHeaders() });
    if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
    const file = await response.json();
    return {
        sha: file.sha,
        value: JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'))
    };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!process.env.GITHUB_TOKEN) return res.status(500).json({ error: 'GitHub integration is not configured.' });

    try {
        const { action, file, value, message } = req.body || {};
        const path = file === 'users' ? USERS_PATH : DATA_PATH;

        if (action === 'read') {
            const result = await readGithubFile(path);
            return res.status(200).json(result.value);
        }

        if (action !== 'write' || !value || typeof value !== 'object') {
            return res.status(400).json({ error: 'A valid synchronization action and value are required.' });
        }

        const existing = await readGithubFile(path);
        const response = await fetch(githubUrl(path), {
            method: 'PUT',
            headers: githubHeaders(),
            body: JSON.stringify({
                message: message || `Update ${path}`,
                content: encodeContent(value),
                sha: existing.sha,
                branch: BRANCH
            })
        });
        if (!response.ok) throw new Error(`GitHub write failed (${response.status})`);
        return res.status(200).json({ success: true, value });
    } catch (error) {
        const status = /401|403/.test(error.message) ? 502 : 500;
        return res.status(status).json({ error: error.message });
    }
}