import { dbEngine, getDeletedRegistry, isMemberIdDeleted, recordDeletion, unrecordDeletion } from "../server/db";
import fs from "fs";

async function runTest() {
  console.log("=== STEP 1: Verify Initial Member State ===");
  const initialMembers = await dbEngine.getMembers(false);
  console.log(`Current active members count: ${initialMembers.length}`);
  if (initialMembers.length === 0) {
    throw new Error("No active members to test deletion on!");
  }

  // Create a dedicated dummy test member for end-to-end deletion testing
  console.log("\n=== STEP 2: Creating Test Member ===");
  const testSubId = "test-sub-" + Date.now();
  const testMemberPayload = {
    id: "test-delete-member-" + Date.now(),
    firstName: "TestDeleteFirst",
    lastName: "TestDeleteLast",
    clanMemberNumber: "TEST-DEL-" + Math.floor(Math.random() * 10000),
    email: "testdelete" + Date.now() + "@example.com",
    sex: "Male",
    branchType: "heritage"
  };

  const addResult = await dbEngine.addMember(testMemberPayload, "deodatusmaliti2@gmail.com", testSubId);
  const createdId = addResult.member.id;
  console.log(`Created test member: ${createdId} (${testMemberPayload.firstName} ${testMemberPayload.lastName})`);

  // Verify member is present in active list
  let activeList = await dbEngine.getMembers(false);
  let found = activeList.find(m => m.id === createdId);
  if (!found) {
    throw new Error(`Test member was not found in active list right after creation!`);
  }
  console.log(`✓ Confirmed: Test member ${createdId} is in active list.`);

  // STEP 3: Perform Deletion
  console.log("\n=== STEP 3: Deleting Member ===");
  await dbEngine.softDeleteMember(createdId, "deodatusmaliti2@gmail.com");
  console.log(`✓ softDeleteMember executed for ${createdId}`);

  // Verify deleted registry
  const isDeleted = isMemberIdDeleted(createdId, testMemberPayload.clanMemberNumber, testMemberPayload.email, "testdeletefirst_testdeletelast");
  console.log(`isMemberIdDeleted result: ${isDeleted}`);
  if (!isDeleted) {
    throw new Error(`Member ${createdId} was not recorded in persistent deleted registry!`);
  }
  console.log(`✓ Confirmed: Member recorded in persistent deleted registry.`);

  // STEP 4: Test for Member Reappearing Across Multiple Background Sync Cycles
  console.log("\n=== STEP 4: Testing for Reappearance Across 10 Repeated Sync Pulses ===");
  for (let cycle = 1; cycle <= 10; cycle++) {
    const fetched = await dbEngine.getMembers(false);
    const reappeared = fetched.find(m => m.id === createdId || m.clanMemberNumber === testMemberPayload.clanMemberNumber || m.email === testMemberPayload.email);
    if (reappeared) {
      throw new Error(`FAILURE: Member ${createdId} reappeared on sync pulse cycle ${cycle}!`);
    }
  }
  console.log("✓ SUCCESS: Member did NOT reappear across 10 continuous sync cycles!");

  // STEP 5: Test Permanent Deletion
  console.log("\n=== STEP 5: Testing Permanent Deletion ===");
  await dbEngine.permanentDeleteMember(createdId, "deodatusmaliti2@gmail.com");
  activeList = await dbEngine.getMembers(false);
  found = activeList.find(m => m.id === createdId);
  if (found) {
    throw new Error(`FAILURE: Member ${createdId} still in active list after permanent delete!`);
  }
  console.log("✓ SUCCESS: Member remains permanently removed.");

  // Clean up test entry from deleted registry
  unrecordDeletion(createdId);
  console.log("\n=== ALL DELETION AND REAPPEARANCE TESTS PASSED! ===");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
