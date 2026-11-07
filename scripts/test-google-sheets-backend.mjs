import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('🚀 Starting Comprehensive Google Sheets Backend Test Suite...\n');

  // Step 0: Reset the mock sheet
  console.log('Step 0: Resetting mock Google Sheet...');
  const resetRes = await fetch(`${BASE_URL}/api/sheets/mock-echo?action=reset`);
  assert.strictEqual(resetRes.ok, true, 'Reset should succeed');
  const initialRows = await (await fetch(`${BASE_URL}/api/sheets/mock-echo`)).json();
  console.log(`✓ Initial Mock Google Sheet rows: ${initialRows.length}`);
  assert.strictEqual(initialRows.length, 2, 'Should have 2 baseline rows');

  // Step 1: Test Connection
  console.log('\nStep 1: Testing Google Sheets Connection Probe...');
  const connRes = await fetch(`${BASE_URL}/api/sheets/test-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webAppUrl: `${BASE_URL}/api/sheets/mock-echo` })
  });
  assert.strictEqual(connRes.ok, true);
  const connData = await connRes.json();
  console.log(`✓ Connection Result:`, connData);
  assert.strictEqual(connData.success, true);
  assert.strictEqual(connData.reachable, true);

  // Step 2: SAVE / ADD new member to Google Sheet
  console.log('\nStep 2: Testing SAVE / ADD member to Google Sheet via Proxy (/api/sheets/push)...');
  const newMember = {
    id: 'test_member_101',
    firstName: 'Godfrey',
    middleName: 'D',
    lastName: 'Maliti',
    email: 'godfrey@testclan.org',
    branchType: 'maliti',
    deceased: false
  };

  const pushRes = await fetch(`${BASE_URL}/api/sheets/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webAppUrl: `${BASE_URL}/api/sheets/mock-echo`,
      member: newMember
    })
  });
  assert.strictEqual(pushRes.ok, true);
  const pushData = await pushRes.json();
  console.log(`✓ Push (Save) Result:`, pushData);
  assert.strictEqual(pushData.success, true);

  // Verify row added to Sheet
  const rowsAfterAdd = await (await fetch(`${BASE_URL}/api/sheets/mock-echo`)).json();
  console.log(`✓ Total rows after ADD: ${rowsAfterAdd.length}`);
  const addedRow = rowsAfterAdd.find(r => r['Member ID'] === 'test_member_101');
  assert.ok(addedRow, 'Newly added member must exist in Google Sheet');
  assert.strictEqual(addedRow['First Name'], 'Godfrey');

  // Step 3: EDIT / UPDATE existing member in Google Sheet
  console.log('\nStep 3: Testing EDIT / UPDATE member in Google Sheet via Proxy (/api/sheets/push)...');
  const updatedMember = {
    id: 'test_member_101',
    firstName: 'Godfrey-Edited',
    middleName: 'David',
    lastName: 'Maliti',
    email: 'godfrey@testclan.org',
    branchType: 'maliti',
    deceased: false
  };

  const editRes = await fetch(`${BASE_URL}/api/sheets/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webAppUrl: `${BASE_URL}/api/sheets/mock-echo`,
      member: updatedMember
    })
  });
  assert.strictEqual(editRes.ok, true);

  // Verify row updated in Sheet without creating duplicate
  const rowsAfterEdit = await (await fetch(`${BASE_URL}/api/sheets/mock-echo`)).json();
  const editedRow = rowsAfterEdit.find(r => r['Member ID'] === 'test_member_101');
  assert.ok(editedRow, 'Updated member must exist in Google Sheet');
  assert.strictEqual(editedRow['First Name'], 'Godfrey-Edited', 'First name must be updated in sheet');
  assert.strictEqual(rowsAfterEdit.filter(r => r['Member ID'] === 'test_member_101').length, 1, 'No duplicate rows allowed');
  console.log(`✓ Member edited in-place successfully. Verified First Name = "${editedRow['First Name']}".`);

  // Step 4: DELETE member from App to Google Sheet
  console.log('\nStep 4: Testing DELETE member from App to Google Sheet via Proxy (/api/sheets/delete)...');
  const deleteRes = await fetch(`${BASE_URL}/api/sheets/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webAppUrl: `${BASE_URL}/api/sheets/mock-echo`,
      id: 'test_member_101',
      email: 'godfrey@testclan.org',
      action: 'delete'
    })
  });
  assert.strictEqual(deleteRes.ok, true);
  const deleteData = await deleteRes.json();
  console.log(`✓ Delete Result:`, deleteData);
  assert.strictEqual(deleteData.success, true);

  // Verify row deleted from Sheet
  const rowsAfterDelete = await (await fetch(`${BASE_URL}/api/sheets/mock-echo`)).json();
  const deletedCheck = rowsAfterDelete.find(r => r['Member ID'] === 'test_member_101');
  assert.strictEqual(deletedCheck, undefined, 'Member must be purged from Google Sheet');
  console.log(`✓ Member test_member_101 successfully deleted from Google Sheet!`);

  // Step 5: BATCH DELETE multiple members from App to Google Sheet
  console.log('\nStep 5: Testing BATCH DELETE members from App to Google Sheet via Proxy...');
  // First add two batch test members
  await fetch(`${BASE_URL}/api/sheets/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webAppUrl: `${BASE_URL}/api/sheets/mock-echo`,
      members: [
        { id: 'batch_del_1', firstName: 'Batch1', lastName: 'Test' },
        { id: 'batch_del_2', firstName: 'Batch2', lastName: 'Test' }
      ]
    })
  });

  const rowsBeforeBatchDel = await (await fetch(`${BASE_URL}/api/sheets/mock-echo`)).json();
  assert.ok(rowsBeforeBatchDel.some(r => r['Member ID'] === 'batch_del_1'));
  assert.ok(rowsBeforeBatchDel.some(r => r['Member ID'] === 'batch_del_2'));
  console.log(`✓ Seeded 2 batch test records. Total rows: ${rowsBeforeBatchDel.length}`);

  // Now execute batch delete
  const batchDelRes = await fetch(`${BASE_URL}/api/sheets/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webAppUrl: `${BASE_URL}/api/sheets/mock-echo`,
      ids: ['batch_del_1', 'batch_del_2'],
      action: 'delete'
    })
  });
  assert.strictEqual(batchDelRes.ok, true);
  const batchDelData = await batchDelRes.json();
  console.log(`✓ Batch Delete Result:`, batchDelData);
  assert.strictEqual(batchDelData.success, true);

  const rowsAfterBatchDel = await (await fetch(`${BASE_URL}/api/sheets/mock-echo`)).json();
  assert.strictEqual(rowsAfterBatchDel.some(r => r['Member ID'] === 'batch_del_1'), false);
  assert.strictEqual(rowsAfterBatchDel.some(r => r['Member ID'] === 'batch_del_2'), false);
  console.log(`✓ Both batch_del_1 and batch_del_2 successfully removed from Google Sheet!`);

  // Step 6: Test DELETE FROM GOOGLE SHEET -> APP SYNC RECONCILIATION
  console.log('\nStep 6: Testing DELETE FROM GOOGLE SHEET -> APP Reconciliation Simulation...');
  // Simulate App local state containing: [rec_sample_1, rec_sample_2]
  // In Google Sheet, we delete rec_sample_1 directly via GET ?action=delete&id=rec_sample_1
  const directSheetDel = await (await fetch(`${BASE_URL}/api/sheets/mock-echo?action=delete&id=rec_sample_1`)).json();
  console.log(`✓ Deleted rec_sample_1 directly inside Google Sheet:`, directSheetDel);

  // App fetches current sheet rows via /api/sheets/fetch-data
  const fetchSheetDataRes = await fetch(`${BASE_URL}/api/sheets/fetch-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${BASE_URL}/api/sheets/mock-echo` })
  });
  assert.strictEqual(fetchSheetDataRes.ok, true);
  const sheetDataResult = await fetchSheetDataRes.json();
  assert.strictEqual(sheetDataResult.success, true);
  const activeSheetRows = sheetDataResult.data;
  console.log(`✓ Active rows remaining in Google Sheet: ${activeSheetRows.length}`);

  // Reconcile with local app records:
  const localAppRecords = [
    { id: 'rec_sample_1', firstName: 'Alice', lastName: 'Maina' },
    { id: 'rec_sample_2', firstName: 'Ben', lastName: 'Siara' }
  ];

  const sheetIdSet = new Set(activeSheetRows.map(r => r['Member ID'] || r.id));
  const reconciledAppRecords = localAppRecords.filter(r => sheetIdSet.has(r.id));
  const deletedFromSheet = localAppRecords.filter(r => !sheetIdSet.has(r.id));

  console.log(`✓ Reconciled Deletions Detected: ${deletedFromSheet.length} member(s):`, deletedFromSheet.map(m => m.id));
  assert.strictEqual(deletedFromSheet.length, 1);
  assert.strictEqual(deletedFromSheet[0].id, 'rec_sample_1', 'rec_sample_1 must be reconciled as deleted from sheet');
  assert.strictEqual(reconciledAppRecords.length, 1);
  assert.strictEqual(reconciledAppRecords[0].id, 'rec_sample_2');
  console.log(`✓ Local database cleanly reconciled with Google Sheet deletions!`);

  console.log('\n🎉 ALL GOOGLE SHEETS CRUD & TWO-WAY DELETE SYNC TESTS PASSED PERFECTLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
