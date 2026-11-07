const DEFAULT_REPOSITORY = "deodatusmaliti2-tech/SiaraMaina-Clan-Informatics";
const DEFAULT_BRANCH = "main";
const DATA_PATH = "siara-maina-clan-data.json";
const USERS_PATH = "siara-maina-clan-users.json";

function githubUrl(repository, path) {
  return `https://api.github.com/repos/${repository}/contents/${path}`;
}


function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readGithubFile(repository, path, headers) {
  const response = await fetch(githubUrl(repository, path), { headers });
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  const file = await response.json();
  return {
    sha: file.sha,
    value: JSON.parse(decodeBase64(file.content)),
  };
}

export async function onRequestPost({ request, env }) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return Response.json(
      { error: "GitHub integration is not configured." },
      { status: 500 },
    );
  }

  const repository = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = env.GITHUB_BRANCH || DEFAULT_BRANCH;

  try {
    const { action, file, value, message } = await request.json();
    const path = file === "users" ? USERS_PATH : DATA_PATH;
    const headers = githubHeaders(token);

    if (action === "read") {
      const result = await readGithubFile(repository, path, headers);
      return Response.json(result.value);
    }

    if (action !== "write" || !value || typeof value !== "object") {
      return Response.json(
        { error: "A valid synchronization action and value are required." },
        { status: 400 },
      );
    }

    const existing = await readGithubFile(repository, path, headers);
    const response = await fetch(githubUrl(repository, path), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: message || `Update ${path}`,
        content: encodeBase64(JSON.stringify(value, null, 2)),
        sha: existing.sha,
        branch,
      }),
    });
    if (!response.ok) throw new Error(`GitHub write failed (${response.status})`);
    return Response.json({ success: true, value });
  } catch (error) {
    const status = /401|403/.test(error.message) ? 502 : 500;
    return Response.json({ error: error.message }, { status });
  }
}