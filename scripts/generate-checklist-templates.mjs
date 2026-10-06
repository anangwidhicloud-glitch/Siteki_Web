import { readFile, writeFile } from 'node:fs/promises';

async function run() {
  const pdfItems = JSON.parse(await readFile('parsed_pdf_items.json', 'utf8'));

  const machineTemplates = {};
  const jenisTemplates = {};
  const categoryTemplates = {};

  pdfItems.forEach(item => {
    const rawNama = String(item.nama || '').trim();
    const rawJenis = String(item.jenis || '').trim();
    const rawKategori = String(item.kategori || '').trim();
    const code = String(item.schedule_code || 'M').toUpperCase().trim();
    const itemName = String(item.item || '').trim();
    if (!itemName) return;

    if (rawNama) {
      const mKey = `${rawNama.toLowerCase()}|${code}`;
      if (!machineTemplates[mKey]) machineTemplates[mKey] = [];
      if (!machineTemplates[mKey].includes(itemName)) machineTemplates[mKey].push(itemName);
    }

    if (rawJenis) {
      const jKey = `${rawJenis.toLowerCase()}|${code}`;
      if (!jenisTemplates[jKey]) jenisTemplates[jKey] = [];
      if (!jenisTemplates[jKey].includes(itemName)) jenisTemplates[jKey].push(itemName);
    }

    if (rawKategori) {
      const cKey = `${rawKategori.toLowerCase()}|${code}`;
      if (!categoryTemplates[cKey]) categoryTemplates[cKey] = [];
      if (!categoryTemplates[cKey].includes(itemName)) categoryTemplates[cKey].push(itemName);
    }
  });

  const fileContent = `// Auto-generated checklist template definitions per machine & maintenance frequency
export const MACHINE_CHECKLIST_TEMPLATES = ${JSON.stringify(machineTemplates, null, 2)};

export const JENIS_CHECKLIST_TEMPLATES = ${JSON.stringify(jenisTemplates, null, 2)};

export const CATEGORY_CHECKLIST_TEMPLATES = ${JSON.stringify(categoryTemplates, null, 2)};

export function getChecklistItems(namaMesin, jenis, kategori, scheduleCode = "M") {
  const code = (scheduleCode || "M").toUpperCase().trim() === "B" ? "B" : "M";
  const normName = String(namaMesin || "").toLowerCase().trim();
  const normJenis = String(jenis || "").toLowerCase().trim();
  const normKategori = String(kategori || "").toLowerCase().trim();

  // 1. Try exact machine name + schedule code
  if (normName && MACHINE_CHECKLIST_TEMPLATES[\`\${normName}|\${code}\`]) {
    return [...MACHINE_CHECKLIST_TEMPLATES[\`\${normName}|\${code}\`]];
  }

  // 1b. Try fuzzy matching machine name (e.g. ignoring prefix or suffix)
  for (const [key, items] of Object.entries(MACHINE_CHECKLIST_TEMPLATES)) {
    const [templateName, templateCode] = key.split("|");
    if (templateCode === code && normName && (normName.includes(templateName) || templateName.includes(normName))) {
      return [...items];
    }
  }

  // 2. Try jenis + schedule code
  if (normJenis && JENIS_CHECKLIST_TEMPLATES[\`\${normJenis}|\${code}\`]) {
    return [...JENIS_CHECKLIST_TEMPLATES[\`\${normJenis}|\${code}\`]];
  }

  // 3. Try category + schedule code
  if (normKategori && CATEGORY_CHECKLIST_TEMPLATES[\`\${normKategori}|\${code}\`]) {
    return [...CATEGORY_CHECKLIST_TEMPLATES[\`\${normKategori}|\${code}\`]];
  }

  // 4. Default fallback general checklist
  if (normKategori === "armada") {
    return code === "B"
      ? [
          "Kebersihan", "Filter Bahan Bakar", "Tangki Bahan Bakar", "Busi",
          "Tromol Dan Kampas Rem", "Selang Dan Pipa Rem", "Kabel Dan Tuas Rem Tangan",
          "Pedal Gas Dan Kopling", "Gear Box", "Sistem Kemudi", "Sistem Pendingin Mesin",
          "Pintu, Engsel, Dan Kunci", "Kelistrikan dan Accu", "Lampu - Lampu", "Transmisi"
        ]
      : [
          "Kebersihan", "Ban", "Ban Serep", "Air Radiator", "Oli Mesin", "Oli Rem",
          "Oli Transmisi", "Oli Gardan", "Air Wiper Kaca", "Sistem Suspensi",
          "Van Belt", "Timing Belt", "Filter Oli", "Filter Udara"
        ];
  }

  return code === "B"
    ? [
        "Kebersihan", "Baut dan Mur", "Pelumasan Rantai / Gear", "Motor & Gearbox",
        "Panel Listrik & Wiring", "Suhu Operasional", "Sistem Pengaman / Sensor",
        "Kondisi Bearing", "Vibrasi Mesin", "Uji Fungsi Keseluruhan"
      ]
    : [
        "Kebersihan", "Cek Baut dan Mur", "Pelumasan / Grease", "Kabel & Sambungan",
        "Suara / Getaran Abnormal", "Tekanan / Aliran Angin", "Kerapian Area Mesin",
        "Uji Fungsi Tombol Emergency"
      ];
}
`;

  await writeFile('src/lib/maintenanceChecklistTemplates.js', fileContent, 'utf8');
  console.log('Successfully generated src/lib/maintenanceChecklistTemplates.js');
}

run().catch(console.error);
