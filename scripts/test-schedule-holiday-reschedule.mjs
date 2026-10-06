import { readFile } from "node:fs/promises";

const SCHEDULE_MACHINES = [
  "Mobile Crane B", "Truck Dump DT39", "Truck Trailler H1983HG", "Mobile Crane C",
  "Forklift A FD35", "Truck Dump DT52", "Truck Trailler H8318QO", "Mobile Crane D",
  "Truck Dump DT55", "Panther H8629JA", "Truck Trailler H8696OA", "Mobile Crane E",
  "Truck Dump DT98", "Truck Trailler H8697OA", "Panther H1669SQ", "Mobile Crane A",
  "Truck Dump DT139", "Truck Trailler H1358KS", "Forklift B FD250", "Suzuki APV",
  "Kop C", "Kop D", "Kop E", "Kop F", "Line 13", "Line 14", "Line 15",
  "Lakop D", "Slitting", "Line 16", "Line 17", "Line 18", "Tes Bending TELKOM",
  "Tes Jatuh Telkom", "Bevel", "Tes Bending PLN", "Verloop D", "Verloop H", "Verloop E",
  "Verloop F", "Kompressor 01", "Line 01", "Line 02", "Line 03", "Verloop A", "Lakop A",
  "Kop A", "Kop B", "Kompressor 02", "Line 04", "Line 05", "Line 06", "Verloop B",
  "Verloop C", "Lakop B", "Lakop C", "Line 07", "Line 08", "Line 09", "Pipa ERW",
  "Verloop G", "Potong Bahan A", "Potong Spiral", "Genset 01", "Line 10", "Line 11", "Line 12"
];

const SCHEDULE_RULES = Object.fromEntries([
  ["Mobile Crane B", 1, [3]], ["Truck Dump DT39", 1, [2]], ["Truck Trailler H1983HG", 1, [1]], ["Mobile Crane C", 1, [4]],
  ["Kop C", 1, [3]], ["Kop D", 1, [2]], ["Kop E", 1, [1]], ["Kop F", 1, [4]], ["Line 13", 1, [2]], ["Line 14", 1, [1]], ["Line 15", 1, [4]], ["Lakop D", 1, [3]],
  ["Forklift A FD35", 2, [3]], ["Truck Dump DT52", 2, [2]], ["Truck Trailler H8318QO", 2, [1]], ["Mobile Crane D", 2, [4]],
  ["Slitting", 2, [2]], ["Line 16", 2, [1]], ["Line 17", 2, [4]], ["Line 18", 2, [3]], ["Tes Bending TELKOM", 2, [2]], ["Tes Jatuh Telkom", 2, [1]], ["Bevel", 2, [4]], ["Tes Bending PLN", 2, [3]], ["Verloop D", 2, [2]],
  ["Truck Dump DT55", 3, [3]], ["Panther H8629JA", 3, [2]], ["Truck Trailler H8696OA", 3, [1]], ["Mobile Crane E", 3, [4]],
  ["Verloop H", 3, [1]], ["Verloop E", 3, [4]], ["Verloop F", 3, [3]], ["Kompressor 01", 3, [2]], ["Line 01", 3, [1]], ["Line 02", 3, [4]], ["Line 03", 3, [3]], ["Verloop A", 3, [2]], ["Lakop A", 3, [1]],
  ["Truck Dump DT98", 4, [3]], ["Truck Trailler H8697OA", 4, [2]], ["Panther H1669SQ", 4, [1]], ["Kop A", 4, [4]], ["Kop B", 4, [3]], ["Kompressor 02", 4, [2]], ["Line 04", 4, [1]], ["Line 05", 4, [4]], ["Line 06", 4, [3]], ["Verloop B", 4, [2]], ["Verloop C", 4, [1]], ["Lakop B", 4, [3]],
  ["Lakop C", 5, [3]], ["Mobile Crane A", 5, [3]], ["Truck Dump DT139", 5, [2]], ["Truck Trailler H1358KS", 5, [1]],
  ["Line 07", 5, [2]], ["Line 08", 5, [1]], ["Line 09", 5, [4]], ["Pipa ERW", 5, [3]], ["Verloop G", 5, [2]], ["Potong Bahan A", 5, [1]],
  ["Forklift B FD250", 6, [1]], ["Suzuki APV", 6, [3]], ["Potong Spiral", 6, [4]], ["Genset 01", 6, [3]], ["Line 10", 6, [2]], ["Line 11", 6, [1]], ["Line 12", 6, [3]]
].map(([name, weekday, weeks]) => [name, { weekday, weeks }]));

const SCHEDULE_HOLIDAYS = {
  2024: { 1: [1], 2: [8, 10], 3: [11, 29, 31], 4: [10, 11], 5: [1, 9, 23], 6: [1, 17], 7: [7], 8: [17], 9: [16], 12: [25] },
  2025: { 1: [1, 27, 29], 2: [10], 3: [28, 29, 31], 4: [1, 18], 5: [1, 12, 29], 6: [1, 7, 27], 8: [17], 9: [5], 12: [25] },
  2026: { 1: [1, 19], 2: [17], 3: [20, 21, 28], 4: [3, 5], 5: [1, 14, 31], 6: [1, 22], 8: [17], 9: [5], 12: [25] }
};

export function buildMonthlyPlanSchedule(month, year) {
  const totalDays = new Date(year, month + 1, 0).getDate();
  const holidays = SCHEDULE_HOLIDAYS[year]?.[month + 1] || [];

  const isHoliday = (day) => {
    const d = new Date(year, month, day, 12);
    return d.getDay() === 0 || holidays.includes(day);
  };

  // All working days in the month (Monday-Saturday, non-holiday)
  const workingDays = [];
  for (let d = 1; d <= totalDays; d++) {
    if (!isHoliday(d)) workingDays.push(d);
  }

  // Weekday occurrences
  const weekdayDates = {};
  for (let d = 1; d <= totalDays; d++) {
    const wd = new Date(year, month, d, 12).getDay();
    if (wd >= 1 && wd <= 6) {
      if (!weekdayDates[wd]) weekdayDates[wd] = [];
      weekdayDates[wd].push(d);
    }
  }

  // Final schedule: machineName -> { day: status (M/B) }
  const schedule = {};
  SCHEDULE_MACHINES.forEach(name => schedule[name] = {});

  // Group machines by their assigned weekday
  const machinesByWeekday = {};
  for (let wd = 1; wd <= 6; wd++) machinesByWeekday[wd] = [];
  SCHEDULE_MACHINES.forEach(name => {
    const rule = SCHEDULE_RULES[name];
    if (rule) machinesByWeekday[rule.weekday].push(name);
  });

  const displaced = [];

  // Step 1: Assign 4 regular occurrences
  for (let wd = 1; wd <= 6; wd++) {
    const days = weekdayDates[wd] || [];
    const machines = machinesByWeekday[wd];

    for (let occ = 0; occ < 4; occ++) {
      const day = days[occ];
      if (!day) continue;

      const occNum = occ + 1;
      const onHoliday = isHoliday(day);

      machines.forEach(name => {
        const rule = SCHEDULE_RULES[name];
        const type = rule.weeks.includes(occNum) ? "B" : "M";

        if (!onHoliday) {
          schedule[name][day] = type;
        } else {
          displaced.push({ name, type, originalDay: day, weekday: wd, occNum });
        }
      });
    }
  }

  // Step 2: Handle displaced machines
  // "jika ada mesin / armada yang seharusnya ada jadwal perawatan, tetapi di hari itu ada libur nasional/tanggal merah,
  //  maka dipindah ke minggu terakhir, jika bulan tersebut ada 5 minggu.
  //  jika bulan itu tetap ada 4 minggu, maka perawatan yang jatuh di hari libur nasional,
  //  dibagi ke hari depannya setiap hari ditambah 1 mesin / armada."
  const remainingDisplaced = [];

  displaced.forEach(item => {
    const wdDays = weekdayDates[item.weekday] || [];
    const has5thWeek = wdDays.length >= 5;
    const fifthDay = has5thWeek ? wdDays[4] : null;

    if (has5thWeek && fifthDay && !isHoliday(fifthDay) && !schedule[item.name][fifthDay]) {
      schedule[item.name][fifthDay] = item.type;
    } else {
      remainingDisplaced.push(item);
    }
  });

  // Distribute remaining displaced machines across subsequent working days (1 machine per day)
  // Ensure we do not assign to a day where the machine already has a schedule
  const byHolidayDay = {};
  remainingDisplaced.forEach(item => {
    if (!byHolidayDay[item.originalDay]) byHolidayDay[item.originalDay] = [];
    byHolidayDay[item.originalDay].push(item);
  });

  for (const [holDayStr, items] of Object.entries(byHolidayDay)) {
    const holDay = Number(holDayStr);
    const subsequentWorkingDays = workingDays.filter(d => d > holDay);
    const priorWorkingDays = workingDays.filter(d => d < holDay);
    const candidateDays = [...subsequentWorkingDays, ...priorWorkingDays];

    let candidatePointer = 0;

    items.forEach(item => {
      // Find candidate day where item.name does not already have a schedule
      let foundDay = null;
      for (let attempts = 0; attempts < candidateDays.length; attempts++) {
        const checkDay = candidateDays[(candidatePointer + attempts) % candidateDays.length];
        if (!schedule[item.name][checkDay]) {
          foundDay = checkDay;
          candidatePointer = (candidatePointer + attempts + 1) % candidateDays.length;
          break;
        }
      }

      if (foundDay) {
        schedule[item.name][foundDay] = item.type;
      } else {
        // Fallback: place on any available working day
        const anyWorkingDay = workingDays.find(d => !schedule[item.name][d]);
        if (anyWorkingDay) {
          schedule[item.name][anyWorkingDay] = item.type;
        }
      }
    });
  }

  return schedule;
}

// Run test across all months in 2024, 2025, 2026
console.log("=== TESTING COMPLETE HOLIDAY RESCHEDULE LOGIC (2024 - 2026) ===");
for (const year of [2024, 2025, 2026]) {
  console.log(`\n=================== TAHUN ${year} ===================`);
  for (let m = 0; m < 12; m++) {
    const sched = buildMonthlyPlanSchedule(m, year);
    let totalPlans = 0;
    const countsPerMachine = {};
    const machineEntries = Object.entries(sched);

    machineEntries.forEach(([name, days]) => {
      const dayCount = Object.keys(days).length;
      totalPlans += dayCount;
      countsPerMachine[name] = { total: dayCount, days };
    });

    const incomplete = Object.entries(countsPerMachine).filter(([_, c]) => c.total !== 4);
    const mName = new Intl.DateTimeFormat("id-ID", { month: "long" }).format(new Date(year, m, 1));
    console.log(`Bulan ${mName} ${year}: Total Rencana: ${totalPlans} / 268 | Status: ${incomplete.length === 0 ? "100% LENGKAP (Semua 67 mesin pas 4x)" : `Ada ${incomplete.length} mesin tidak 4x`}`);

    if (incomplete.length > 0) {
      console.log("  Mesin belum 4x:", incomplete.map(([n, c]) => `${n}: ${c.total}x`).join(", "));
    }
  }
}
