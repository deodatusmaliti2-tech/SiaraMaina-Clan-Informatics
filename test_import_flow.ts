import { dbEngine } from "./server/db";

async function testImport() {
  try {
    console.log("Testing importMembersBatch...");
    const testMembers = [
      { id: "test-m-1", firstName: "TestFirstName1", lastName: "TestLastName1", sex: "Male" },
      { id: "test-m-2", firstName: "TestFirstName2", lastName: "TestLastName2", sex: "Female" }
    ];
    const res = await dbEngine.importMembersBatch(testMembers, "test_importer@example.com");
    console.log("Import result:", { added: res.added, updated: res.updated, count: res.count });
    console.log("Returned members count:", res.members.length);
  } catch (e) {
    console.error("importMembersBatch threw error:", e);
  }
}

testImport();
