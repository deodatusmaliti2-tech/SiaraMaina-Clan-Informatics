import { AsyncLocalStorage } from "async_hooks";

export const firebaseTokenStorage = new AsyncLocalStorage<string | null>();

export function runWithFirebaseToken<T>(token: string | null | undefined, fn: () => T): T {
  const clean = token && typeof token === "string" && token.split(".").length === 3 ? token.trim() : null;
  return firebaseTokenStorage.run(clean, fn);
}

export function getRequestFirebaseIdToken(): string | null {
  return firebaseTokenStorage.getStore() || null;
}

function getBaseUrl(projectId: string, databaseId: string): string {
  const dbId = databaseId || "(default)";
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents`;
}

export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return { nullValue: null };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === "object") {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: any): any {
  if (!val || typeof val !== "object") return null;
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return Boolean(val.booleanValue);
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("stringValue" in val) return String(val.stringValue);
  if ("timestampValue" in val) return String(val.timestampValue);
  if ("arrayValue" in val) {
    const arr = val.arrayValue?.values;
    return Array.isArray(arr) ? arr.map(fromFirestoreValue) : [];
  }
  if ("mapValue" in val) {
    const fields = val.mapValue?.fields || {};
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

export function toFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

export function fromFirestoreDoc(docJson: any): { id: string; data: Record<string, any> } | null {
  if (!docJson || !docJson.name) return null;
  const parts = String(docJson.name).split("/");
  const id = parts[parts.length - 1] || "";
  const fields = docJson.fields || {};
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) {
    data[k] = fromFirestoreValue(v);
  }
  return { id, data };
}

async function parseFirestoreError(res: Response): Promise<Error> {
  let msg = `Firestore HTTP ${res.status}`;
  let code = "";
  try {
    const body = await res.json();
    msg = body?.error?.message || msg;
    code = String(body?.error?.status || "").toLowerCase();
  } catch {}
  const err: any = new Error(msg);
  if (res.status === 403 || code.includes("permission")) err.code = "permission-denied";
  else if (res.status === 429 || code.includes("resource_exhausted")) err.code = "resource-exhausted";
  else if (res.status === 404) err.code = "not-found";
  return err;
}

export async function fsRestGetDoc(
  projectId: string,
  databaseId: string,
  collectionPath: string,
  docId: string,
  idToken: string
): Promise<Record<string, any> | null> {
  const url = `${getBaseUrl(projectId, databaseId)}/${collectionPath}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await parseFirestoreError(res);
  const json = await res.json();
  const parsed = fromFirestoreDoc(json);
  return parsed ? parsed.data : null;
}

export async function fsRestListCollection(
  projectId: string,
  databaseId: string,
  collectionPath: string,
  idToken: string,
  pageSize = 500
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const results: Array<{ id: string; data: Record<string, any> }> = [];
  let pageToken = "";
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `${getBaseUrl(projectId, databaseId)}/${collectionPath}?${qs.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 404) return [];
    if (!res.ok) throw await parseFirestoreError(res);
    const json = (await res.json()) as any;
    const docs = Array.isArray(json.documents) ? json.documents : [];
    for (const d of docs) {
      const parsed = fromFirestoreDoc(d);
      if (parsed) results.push(parsed);
    }
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return results;
}

export async function fsRestSetDoc(
  projectId: string,
  databaseId: string,
  collectionPath: string,
  docId: string,
  data: Record<string, any>,
  idToken: string,
  merge = true
): Promise<void> {
  const cleanEntries = Object.entries(data || {}).filter(([, v]) => v !== undefined);
  const qs = new URLSearchParams();
  if (merge) {
    for (const [k] of cleanEntries) {
      const safePath = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : `\`${k.replace(/`/g, "\\`")}\``;
      qs.append("updateMask.fieldPaths", safePath);
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const url = `${getBaseUrl(projectId, databaseId)}/${collectionPath}/${encodeURIComponent(docId)}${suffix}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw await parseFirestoreError(res);
}

export async function fsRestDeleteDoc(
  projectId: string,
  databaseId: string,
  collectionPath: string,
  docId: string,
  idToken: string
): Promise<void> {
  const url = `${getBaseUrl(projectId, databaseId)}/${collectionPath}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return;
  if (!res.ok) throw await parseFirestoreError(res);
}

export async function fsRestQueryEq(
  projectId: string,
  databaseId: string,
  collectionPath: string,
  field: string,
  value: string,
  idToken: string
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const url = `${getBaseUrl(projectId, databaseId)}:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collectionPath }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: toFirestoreValue(value),
          },
        },
      },
    }),
  });
  if (!res.ok) throw await parseFirestoreError(res);
  const rows = (await res.json()) as any[];
  const results: Array<{ id: string; data: Record<string, any> }> = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && row.document) {
        const parsed = fromFirestoreDoc(row.document);
        if (parsed) results.push(parsed);
      }
    }
  }
  return results;
}
