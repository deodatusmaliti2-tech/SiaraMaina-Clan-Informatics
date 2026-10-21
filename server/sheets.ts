import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { dbEngine } from "./db";
import { syncManager } from "./sync";

const spreadsheetConfigFile = path.resolve(process.cwd(), "data/spreadsheet_config.json");

export async function serverSyncSheetToApp() {
  try {
    if (!fs.existsSync(spreadsheetConfigFile)) return;
    const config = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
    const url = config.spreadsheetId;
    if (!url) return;

    // Use the public GViz endpoint if it's a sheet URL
    const fetchUrl = url.includes("docs.google.com/spreadsheets") 
      ? url.replace(/\/edit.*$/, "").replace(/\/view.*$/, "") + "/gviz/tq?tqx=out:json"
      : url;

    const resp = await fetch(fetchUrl);
    if (!resp.ok) return;
    const text = await resp.text();
    // Simplified JSON parsing from GViz
    const jsonStr = text.match(/google\.visualization\.Query\.setResponse\((.*)\);/);
    if (!jsonStr) return;
    const data = JSON.parse(jsonStr[1]);
    
    // Convert GViz format to records
    const records = data.table.rows.map((row: any) => {
      const obj: any = {};
      row.c.forEach((cell: any, i: number) => {
        const colName = data.table.cols[i].label;
        if (colName) obj[colName] = cell ? (cell.v || "") : "";
      });
      return obj;
    }).filter((r: any) => r.id || r.email);

    const result = await dbEngine.importMembersBatch(records, "server_autosync");
    
    // Broadcast change
    syncManager.broadcast("doc_change", {
        action: "SET",
        collection: "members",
        records: result.members,
        timestamp: new Date().toISOString(),
    });
    
    console.log(`[ServerSync] Synced ${result.added} new, ${result.updated} updated.`);
  } catch (e) {
    console.error("[ServerSync] Error:", e);
  }
}
