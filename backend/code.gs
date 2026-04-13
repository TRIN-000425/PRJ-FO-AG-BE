/**
 * SENIOR REVIEWED BACKEND - SECURE OTP & DEVICE TOKENS
 * API VERSION (Sheets API v4)
 */
const CONFIG = {
  SPREADSHEET_ID: "1c_m7Ny1CiD4w-ScxfupkTjX4ogz4vfbOfYiseZEwbao", // Paste your Google Sheet ID here
  DEFAULT_ADMIN_PASS: "password123",
  IMAGE_FOLDER_ID: "1RDlQhgzcxrjHLgcrdSvstItI37jKZyqv", // Paste your Google Drive Folder ID here
  SHEET_NAMES: {
    USERS: "Users",
    UNITS: "UnitTypes",
    STORIES: "Stories",
    MAPS: "Maps",
    DEFECTS: "Defects",
    UNIT_NUMBERS: "UnitNumbers",
    LOGS: "Logs"
  }
};

function logError(err, action, username) {
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId());
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.LOGS) || ss.insertSheet(CONFIG.SHEET_NAMES.LOGS);
    sheet.appendRow([new Date(), username || "unknown", action || "unknown", err.toString()]);
  } catch(e) {}
}

function getSpreadsheetId() {
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID !== "") return CONFIG.SPREADSHEET_ID;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss.getId();
  } catch (e) {}
  throw new Error("CRITICAL: Spreadsheet ID is missing! Please paste your Google Sheet ID into the CONFIG.SPREADSHEET_ID field at the top of the script.");
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'login') return handleLogin(data.username, data.password, data.deviceId);
    if (action === 'verify_otp') return handleVerifyOtp(data.username, data.password, data.deviceId, data.otp);

    // Require authorization for everything else, including config
    if (!isAuthorized(data.auth)) {
      return createResponse({ status: 'error', message: 'Unauthorized: Invalid device token.' });
    }

    if (action === 'get_config') return handleGetConfig();
    if (action === 'sync_defects') return handleSyncDefects(data.defect || data.defects, data.auth.username);

    if (!isAdmin(data.auth)) {
      return createResponse({ status: 'error', message: 'Forbidden: Admin required.' });
    }

    if (action === 'add_unit') return handleAddConfig(CONFIG.SHEET_NAMES.UNITS, [data.value, data.label]);
    if (action === 'add_story') return handleAddConfig(CONFIG.SHEET_NAMES.STORIES, [data.value, data.label, ""]);
    if (action === 'upload_map') return handleUploadMap(data.unit, data.story, data.imageBlob);
    if (action === 'add_map_url') return handleUpdateMapUrl(data.unit, data.story, data.mapUrl);
    if (action === 'add_unit_numbers') return handleBulkAddUnitNumbers(data.units);

    return createResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return createResponse({ status: 'error', message: 'API Error: ' + err.toString() });
  }
}

function handleBulkAddUnitNumbers(units) {
  try {
    if (!units || !Array.isArray(units)) return createResponse({ status: 'error', message: 'Invalid units data received.' });
    
    const ss = SpreadsheetApp.openById(getSpreadsheetId());
    let sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.UNIT_NUMBERS);
    
    // Auto-create sheet if it somehow doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEET_NAMES.UNIT_NUMBERS);
      sheet.appendRow(["UnitNumber", "UnitType"]);
      sheet.setFrozenRows(1);
    }

    const rows = units.map(u => [u.number.toString().trim(), u.type.toString().trim()]);
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
    }
    return createResponse({ status: 'success', message: `Added ${rows.length} units.` });
  } catch (err) {
    return createResponse({ status: 'error', message: 'Backend Error: ' + err.toString() });
  }
}

function handleUpdateMapUrl(unit, story, url) {
  unit = unit.toString().trim();
  story = story.toString().trim();
  const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(CONFIG.SHEET_NAMES.MAPS);
  const data = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === unit && data[i][1].toString().trim() === story) {
      sheet.getRange(i + 1, 3).setValue(url);
      found = true;
      break;
    }
  }
  if (!found) sheet.appendRow([unit, story, url]);
  return createResponse({ status: 'success', url: url });
}

/**
 * HELPER: Save Base64 Image to Drive and return the URL
 */
function saveBase64ToFile(base64Data, fileName, mimeType) {
  if (!CONFIG.IMAGE_FOLDER_ID) throw new Error("Google Drive Folder ID is missing in CONFIG.");

  const folder = DriveApp.getFolderById(CONFIG.IMAGE_FOLDER_ID);
  const bytes = Utilities.base64Decode(base64Data.split(',')[1]);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Returns direct view link
  return file.getDownloadUrl().replace("?e=download", "");
}

function handleSyncDefects(payload, username) {
  const defects = Array.isArray(payload) ? payload : [payload];
  if (defects.length === 0 || !defects[0]) return createResponse({ status: 'error', message: 'Invalid payload.' });

  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.DEFECTS);

  const lastRow = sheet.getLastRow();
  const dataRange = sheet.getDataRange();
  const allData = dataRange.getValues();
  const existingIds = allData.map(r => r[8].toString()); // Defect_ID is index 8

  const valuesToAppend = [];
  
  for (let d of defects) {
    if (!d) continue;
    
    // Process photos
    let photoUrl = d.photoUrl || "No Photo";
    if (d.photo && d.photo.startsWith("data:image")) {
      const fileName = `Defect_${username}_${Date.now()}.jpg`;
      try { photoUrl = saveBase64ToFile(d.photo, fileName, 'image/jpeg'); } 
      catch (err) { photoUrl = "Error: " + err.toString(); }
    }

    let donePhotoUrl = d.donePhotoUrl || "";
    if (d.donePhoto && d.donePhoto.startsWith("data:image")) {
      const fileName = `Done_${username}_${Date.now()}.jpg`;
      try { donePhotoUrl = saveBase64ToFile(d.donePhoto, fileName, 'image/jpeg'); } 
      catch (err) { donePhotoUrl = "Error: " + err.toString(); }
    }

    let safeDesc = d.description ? d.description.toString() : "";
    if (/^[=\+\-@]/.test(safeDesc)) safeDesc = "'" + safeDesc;

    const row = [
      d.timestamp,
      username,
      d.unit,
      d.story,
      d.position && d.position.x ? (typeof d.position.x === 'number' ? d.position.x.toFixed(2) + "%" : d.position.x) : "0%",
      d.position && d.position.y ? (typeof d.position.y === 'number' ? d.position.y.toFixed(2) + "%" : d.position.y) : "0%",
      safeDesc,
      photoUrl,
      d.id,
      d.status || "Open",
      donePhotoUrl
    ];

    const existingIdx = existingIds.indexOf(d.id.toString());
    if (existingIdx !== -1) {
      // Update existing row
      sheet.getRange(existingIdx + 1, 1, 1, row.length).setValues([row]);
    } else {
      valuesToAppend.push(row);
    }
  }

  if (valuesToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, valuesToAppend.length, 11).setValues(valuesToAppend);
  }
  return createResponse({ status: 'success', message: 'Synced' });
}

function handleUploadMap(unit, story, imageBlob) {
  unit = unit.toString().trim();
  story = story.toString().trim();
  const fileName = `${unit}_${story}.png`;
  const folder = DriveApp.getFolderById(CONFIG.IMAGE_FOLDER_ID);
  const existingFiles = folder.getFilesByName(fileName);
  while (existingFiles.hasNext()) { existingFiles.next().setTrashed(true); }

  const url = saveBase64ToFile(imageBlob, fileName, 'image/png');

  const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(CONFIG.SHEET_NAMES.MAPS);
  const data = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === unit && data[i][1].toString().trim() === story) {
      sheet.getRange(i + 1, 3).setValue(url);
      found = true;
      break;
    }
  }
  if (!found) sheet.appendRow([unit, story, url]);

  return createResponse({ status: 'success', url: url });
}

function handleLogin(username, password, deviceId) {
  const users = Sheets.Spreadsheets.Values.get(getSpreadsheetId(), `${CONFIG.SHEET_NAMES.USERS}!A2:H`).values || [];
  const user = users.find(row => row[0] === username && row[1] === password);
  if (user) {
    let lockedDevices = {};
    try { lockedDevices = JSON.parse(user[7] || "{}"); } catch(e) {}
    if (lockedDevices[deviceId]) {
      const lockTime = lockedDevices[deviceId];
      if (Date.now() - lockTime < 30 * 24 * 60 * 60 * 1000) return createResponse({ status: 'error', message: 'Device locked.' });
    }
    let knownDevices = {};
    try { knownDevices = JSON.parse(user[6] || "{}"); } catch(e) {}
    if (knownDevices[deviceId]) {
      return createResponse({ status: 'success', user: { username: user[0], name: user[2], role: user[4] }, deviceToken: knownDevices[deviceId] });
    } else {
      return createResponse({ status: 'requires_otp', message: `Device not recognized. Device ID: ${deviceId}` });
    }
  }
  return createResponse({ status: 'error', message: 'Invalid Login' });
}

function handleVerifyOtp(username, password, deviceId, otp) {
   const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(CONFIG.SHEET_NAMES.USERS);
   const data = sheet.getDataRange().getValues();
   for (let i = 1; i < data.length; i++) {
     if (data[i][0] === username && data[i][1] === password) {
       const sheetOtp = data[i][5] ? data[i][5].toString().trim() : "";
       if (sheetOtp !== "" && sheetOtp === otp.toString().trim()) {
         let knownDevices = {};
         try { knownDevices = JSON.parse(data[i][6] || "{}"); } catch(e) {}
         const deviceToken = Utilities.getUuid();
         knownDevices[deviceId] = deviceToken;
         sheet.getRange(i + 1, 7).setValue(JSON.stringify(knownDevices));
         sheet.getRange(i + 1, 6).clearContent();
         return createResponse({ status: 'success', user: { username: data[i][0], name: data[i][2], role: data[i][4] }, deviceToken: deviceToken });
       } else {
         sheet.getRange(i + 1, 8).setValue(deviceId);
         sheet.getRange(i + 1, 6).clearContent();
         return createResponse({ status: 'error', message: 'Invalid OTP. Device locked.' });
       }
     }
   }
   return createResponse({ status: 'error', message: 'Authentication failed.' });
}

function isAuthorized(auth) {
  if (!auth || !auth.username || !auth.deviceId || !auth.deviceToken) return false;
  const users = Sheets.Spreadsheets.Values.get(getSpreadsheetId(), `${CONFIG.SHEET_NAMES.USERS}!A2:H`).values || [];
  const user = users.find(row => row[0] === auth.username);
  if (!user) return false;
  let lockedDevices = user[7] ? user[7].toString() : "";
  if (lockedDevices.includes(auth.deviceId)) return false;
  try {
    const knownDevices = JSON.parse(user[6] || "{}");
    return knownDevices[auth.deviceId] === auth.deviceToken;
  } catch(e) { return false; }
}

function isAdmin(auth) {
  if (!isAuthorized(auth)) return false;
  const users = Sheets.Spreadsheets.Values.get(getSpreadsheetId(), `${CONFIG.SHEET_NAMES.USERS}!A2:H`).values || [];
  const user = users.find(row => row[0] === auth.username);
  return user && user[4] === 'Admin';
}

function handleGetConfig() {
  const ranges = [
    `${CONFIG.SHEET_NAMES.UNITS}!A2:B`,
    `${CONFIG.SHEET_NAMES.STORIES}!A2:B`,
    `${CONFIG.SHEET_NAMES.MAPS}!A2:C`,
    `${CONFIG.SHEET_NAMES.DEFECTS}!A2:K`,
    `${CONFIG.SHEET_NAMES.UNIT_NUMBERS}!A2:B`
  ];
  const response = Sheets.Spreadsheets.Values.batchGet(getSpreadsheetId(), { ranges: ranges });
  const unitTypes = response.valueRanges[0].values || [];
  const stories = response.valueRanges[1].values || [];
  const maps = response.valueRanges[2] ? (response.valueRanges[2].values || []) : [];
  const defects = response.valueRanges[3] ? (response.valueRanges[3].values || []) : [];
  const unitNumbers = response.valueRanges[4] ? (response.valueRanges[4].values || []) : [];

  return createResponse({
    status: 'success',
    config: {
      unitTypes: unitTypes.map(r => ({ value: (r[0]||"").toString().trim(), label: (r[1]||"").toString().trim() })),
      stories: stories.map(r => ({ value: (r[0]||"").toString().trim(), label: (r[1]||"").toString().trim() })),
      maps: maps.map(r => ({ unit: (r[0]||"").toString().trim(), story: (r[1]||"").toString().trim(), mapUrl: (r[2]||"").toString().trim() })),
      unitNumbers: unitNumbers.map(r => ({ number: (r[0]||"").toString().trim(), type: (r[1]||"").toString().trim() })),
      syncedDefects: defects.map(r => ({
        timestamp: r[0],
        user: r[1],
        unit: (r[2]||"").toString().trim(),
        story: (r[3]||"").toString().trim(),
        position: { x: parseFloat(r[4].toString().replace('%', '')), y: parseFloat(r[5].toString().replace('%', '')) },
        description: r[6],
        photoUrl: r[7],
        id: r[8],
        status: r[9] || "Open",
        donePhotoUrl: r[10] || ""
      }))
    }
  });
}

function handleAddConfig(sheetName, rowValues) {
  Sheets.Spreadsheets.Values.append({ values: [rowValues] }, getSpreadsheetId(), `${sheetName}!A:A`, { valueInputOption: "USER_ENTERED" });
  return createResponse({ status: 'success' });
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function initializeProject() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  setupSheet(ss, CONFIG.SHEET_NAMES.USERS, ["username", "password", "name", "project", "role", "OTP", "known_devices", "locked_devices"], [["admin", "password123", "Administrator", "Main", "Admin", "", "{}", ""]]);
  setupSheet(ss, CONFIG.SHEET_NAMES.UNITS, ["Value", "Label"], [["Type-A", "Type A"], ["Type-B", "Type B"]]);
  setupSheet(ss, CONFIG.SHEET_NAMES.STORIES, ["Value", "Label"], [["L1", "Level 1"], ["L2", "Level 2"]]);
  setupSheet(ss, CONFIG.SHEET_NAMES.MAPS, ["UnitType", "Story", "MapURL"], []);
  setupSheet(ss, CONFIG.SHEET_NAMES.DEFECTS, ["Timestamp", "User", "UnitNumber", "Story", "X_Pos", "Y_Pos", "Description", "Photo_URL", "Defect_ID", "Status", "Done_Photo_URL"], []);
  setupSheet(ss, CONFIG.SHEET_NAMES.UNIT_NUMBERS, ["UnitNumber", "UnitType"], []);
  setupSheet(ss, CONFIG.SHEET_NAMES.LOGS, ["Timestamp", "User", "Action", "Error"], []);
  return "Project Initialized Successfully! ID: " + ss.getId();
}

function setupSheet(ss, name, headers, defaultData) {
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear().getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  if (defaultData.length > 0) sheet.getRange(2, 1, defaultData.length, headers.length).setValues(defaultData);
  sheet.setFrozenRows(1);
}
