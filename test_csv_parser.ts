import fs from "fs";

var CSV_FIELD_MAP = {
  "Member ID":"id", "First Name":"firstName", "Middle Name":"middleName", "Last Name":"lastName",
  "Sex":"sex", "Family Clan":"branchType", "Title / Honorific":"honorific", "Date of Birth":"dob",
  "Historical Age":"birthPeriod", "Place of Birth":"placeOfBirth", "Life Status":"deceased", "Date of Death":"dod",
  "Age at Death":"deathAge", "Cause of Death":"causeOfDeath", "Father Profile":"fatherId", "Mother Profile":"motherId",
  "Spouse Profile":"spouseId", "Sibling Profiles":"siblingIds", "Marital Status":"maritalStatus", "Education Level":"education",
  "Course / Area of Study":"course", "Employment Status":"employment", "Occupation / Profession":"occupation", "Organisation / Employer":"organization",
  "Religious Affiliation":"religion", "Denomination / Tradition":"denomination", "Telephone":"phone", "WhatsApp":"whatsapp",
  "Email Address":"email", "Current Location":"location", "Historical Location":"narrative"
};
var CSV_HEADERS = Object.keys(CSV_FIELD_MAP);
var CSV_LEGACY_HEADER_ALIASES = {
  "id":"id", "member id":"id", "memberid":"id", "record id":"id", "recordid":"id",
  "clan member number":"clanMemberNumber", "clanmembernumber":"clanMemberNumber", "member number":"clanMemberNumber", "member_number":"clanMemberNumber", "number":"clanMemberNumber", "reg no":"clanMemberNumber",
  "firstname":"firstName", "first name":"firstName", "fname":"firstName", "given name":"firstName", "givenname":"firstName",
  "middlename":"middleName", "middle name":"middleName", "mname":"middleName", "other names":"middleName", "othernames":"middleName", "maiden name":"middleName",
  "lastname":"lastName", "last name":"lastName", "lname":"lastName", "surname":"lastName", "family name":"lastName",
  "name":"firstName", "full name":"firstName", "fullname":"firstName",
  "sex":"sex", "gender":"sex",
  "family clan":"branchType", "familyclan":"branchType", "family classification":"branchType", "branchtype":"branchType", "branch":"branchType", "branch type":"branchType", "family":"branchType", "clan branch":"branchType",
  "honorific":"honorific", "title":"honorific", "title / honorific":"honorific", "prefix":"honorific",
  "dob":"dob", "date of birth":"dob", "birth date":"dob", "born":"dob", "birthday":"dob", "birthdate":"dob",
  "historical age":"birthPeriod", "historicalage":"birthPeriod", "historical period":"birthPeriod", "birthperiod":"birthPeriod", "period":"birthPeriod", "birth period":"birthPeriod",
  "placeofbirth":"placeOfBirth", "place of birth":"placeOfBirth", "birth place":"placeOfBirth", "birthplace":"placeOfBirth", "pob":"placeOfBirth",
  "deceased":"deceased", "life status":"deceased", "status":"deceased", "alive":"deceased", "is deceased":"deceased", "dead":"deceased", "is_deceased":"deceased",
  "dod":"dod", "date of death":"dod", "death date":"dod", "deathdate":"dod", "passed away":"dod",
  "deathage":"deathAge", "age at death":"deathAge", "death age":"deathAge", "age":"deathAge",
  "causeofdeath":"causeOfDeath", "cause of death":"causeOfDeath",
  "fatherid":"fatherId", "father profile":"fatherId", "father":"fatherId", "father name":"fatherId", "father_id":"fatherId",
  "motherid":"motherId", "mother profile":"motherId", "mother":"motherId", "mother name":"motherId", "mother_id":"motherId",
  "spouseid":"spouseId", "spouse profile":"spouseId", "spouse":"spouseId", "spouse name":"spouseId", "partner":"spouseId", "husband":"spouseId", "wife":"spouseId", "spouse_id":"spouseId",
  "siblingids":"siblingIds", "sibling profiles":"siblingIds", "siblings":"siblingIds", "sibling names":"siblingIds", "brothers":"siblingIds", "sisters":"siblingIds", "sibling_ids":"siblingIds",
  "maritalstatus":"maritalStatus", "marital status":"maritalStatus", "marital_status":"maritalStatus", "marital":"maritalStatus",
  "education":"education", "education level":"education", "educationlevel":"education", "qualification":"education",
  "course":"course", "course / area of study":"course", "field of study":"course", "study":"course", "major":"course", "degree":"course",
  "employment":"employment", "employment status":"employment", "employment_status":"employment",
  "occupation / profession":"occupation", "occupation":"occupation", "job":"occupation", "profession":"occupation", "career":"occupation", "work":"occupation",
  "organization":"organization", "organisation / employer":"organization", "employer":"organization", "company":"organization", "workplace":"organization",
  "religion":"religion", "faith":"religion", "religious affiliation":"religion",
  "denomination":"denomination", "church":"denomination", "tradition":"denomination", "denomination / tradition":"denomination",
  "telephone":"phone", "telephone number":"phone", "phone":"phone", "mobile":"phone", "phone number":"phone", "cell":"phone", "tel":"phone",
  "whatsapp":"whatsapp", "whatsapp number":"whatsapp", "wa":"whatsapp",
  "email":"email", "email address":"email", "e-mail":"email", "mail":"email",
  "location":"location", "current location":"location", "address":"location", "residence":"location", "city":"location", "town":"location", "country":"location",
  "historical location":"narrative", "historicallocation":"narrative", "historical narrative / notes":"narrative", "narrative":"narrative", "notes":"narrative", "bio":"narrative", "biography":"narrative", "history":"narrative", "remarks":"narrative",
  "photo":"photo", "image":"photo", "photo url":"photo", "photourl":"photo", "picture":"photo"
};

function csvText(value: any) {
  return value === undefined || value === null ? "" : String(value);
}

function parseCsvText(text: string) {
  if (!text) return [];
  text = csvText(text).replace(/^\uFEFF/, "");
  var firstLineEnd = text.search(/[\r\n]/);
  var firstLine = firstLineEnd > -1 ? text.substring(0, firstLineEnd) : text;
  var commaCount = (firstLine.match(/,/g) || []).length;
  var semiCount = (firstLine.match(/;/g) || []).length;
  var tabCount = (firstLine.match(/\t/g) || []).length;
  var pipeCount = (firstLine.match(/\|/g) || []).length;
  var delimiter = ",";
  if (semiCount > commaCount && semiCount >= tabCount) delimiter = ";";
  else if (tabCount > commaCount && tabCount > semiCount) delimiter = "\t";
  else if (pipeCount > commaCount && pipeCount > semiCount) delimiter = "|";

  var rows: string[][] = [], row: string[] = [], value = "", quoted = false;
  for (var i = 0; i < text.length; i++) {
    var character = text.charAt(i), next = text.charAt(i + 1);
    if (character === '"') {
      if (quoted && next === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") i++;
      row.push(value.trim());
      value = "";
      if (row.some(function(cell) { return cell.length > 0; })) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value.trim());
    if (row.some(function(cell) { return cell.length > 0; })) rows.push(row);
  }
  return rows;
}

function normalizeCsvHeader(header: string, index: number) {
  var raw = csvText(header).replace(/^\uFEFF/, "").trim();
  var value = raw.toLowerCase();
  var friendly = CSV_HEADERS.find(function(label) { return label.toLowerCase() === value; });
  if (friendly) return (CSV_FIELD_MAP as any)[friendly];
  var legacy = (CSV_LEGACY_HEADER_ALIASES as any)[value];
  if (legacy) return legacy;

  var cleaned = value.replace(/[-_.\s]+/g, " ").trim();
  var compact = value.replace(/[^a-z0-9]/g, "");

  var legacyCleaned = (CSV_LEGACY_HEADER_ALIASES as any)[cleaned] || (CSV_LEGACY_HEADER_ALIASES as any)[compact];
  if (legacyCleaned) return legacyCleaned;

  if (compact.indexOf("first") > -1 || compact.indexOf("given") > -1 || compact.indexOf("fname") > -1) return "firstName";
  if (compact.indexOf("last") > -1 || compact.indexOf("surname") > -1 || compact.indexOf("family") > -1 || compact.indexOf("lname") > -1) {
    if (compact.indexOf("clan") > -1 || compact.indexOf("classification") > -1 || compact.indexOf("branch") > -1) return "branchType";
    return "lastName";
  }
  if (compact.indexOf("middle") > -1 || compact.indexOf("othername") > -1 || compact.indexOf("mname") > -1) return "middleName";
  if (compact.indexOf("fullname") > -1 || compact.indexOf("membername") > -1 || compact.indexOf("personname") > -1 || compact === "name") return "firstName";
  if (compact.indexOf("phone") > -1 || compact.indexOf("mobile") > -1 || compact.indexOf("tel") > -1 || compact.indexOf("contact") > -1) return "phone";
  if (compact.indexOf("whatsapp") > -1) return "whatsapp";
  if (compact.indexOf("email") > -1 || compact.indexOf("mail") > -1) return "email";
  if (compact.indexOf("birth") > -1 || compact.indexOf("dob") > -1 || compact.indexOf("born") > -1) return "dob";
  if (compact.indexOf("death") > -1 || compact.indexOf("dod") > -1) return "dod";
  if (compact.indexOf("gender") > -1 || compact.indexOf("sex") > -1) return "sex";
  if (compact.indexOf("branch") > -1 || compact.indexOf("clan") > -1) return "branchType";
  if (compact.indexOf("location") > -1 || compact.indexOf("address") > -1 || compact.indexOf("city") > -1) {
    if (compact.indexOf("historical") > -1 || compact.indexOf("history") > -1) return "narrative";
    return "location";
  }

  return "column" + index;
}

function testFile(filePath: string) {
  console.log(`\n=== Testing ${filePath} ===`);
  const content = fs.readFileSync(filePath, "utf-8");
  const rows = parseCsvText(content);
  console.log(`Parsed total rows: ${rows.length}`);
  if (rows.length === 0) return;

  const firstRow = rows[0];
  console.log(`First row columns (${firstRow.length}):`, firstRow.slice(0, 5));
  const headers = firstRow.map(normalizeCsvHeader);
  console.log("Mapped headers:", headers.slice(0, 10));

  const dataRows = rows.slice(1);
  console.log(`Data rows count: ${dataRows.length}`);
  if (dataRows.length > 0) {
    const sampleVal = dataRows[0];
    const rowObj: any = {};
    headers.forEach((h, i) => { if (h) rowObj[h] = sampleVal[i]; });
    console.log("Sample Row 1 parsed object:", rowObj);
  }
}

testFile("./clan_dataset.csv");
testFile("./test_import.csv");
