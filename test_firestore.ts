import { db } from "./server/firebase_admin";

async function test() {
    try {
        const snapshot = await db.collection("records").get();
        console.log("Successfully connected to Firestore. Found", snapshot.docs.length, "records.");
    } catch (e) {
        console.error("Failed to connect to Firestore:", e);
    }
}
test();
