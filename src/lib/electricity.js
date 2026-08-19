export const PLN_REACTIVE_RATIO = 0.62;
export const PLN_MIN_POWER_FACTOR = 0.85;
export const INDONESIAN_MONTH_LABELS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

const numeric = value => {
  const source=typeof value==="string"?value.trim().replace(/\s+/g,"").replace(",","."):value;
  const parsed = typeof source === "number" ? source : Number(source);
  return Number.isFinite(parsed) ? parsed : null;
};

export function calculateElectricityAssessment(
  { huhe_h, huhe_hh, huar_heh, huar_hh },
  { allowNegative = false } = {},
) {
  const activeCurrent = numeric(huhe_h);
  const activePrevious = numeric(huhe_hh);
  const reactiveCurrent = numeric(huar_heh);
  const reactivePrevious = numeric(huar_hh);

  if ([activeCurrent, activePrevious, reactiveCurrent, reactivePrevious].some(value => value === null)) {
    throw new Error("Empat nilai meter wajib berupa angka.");
  }

  const activeKwh = activeCurrent - activePrevious;
  const reactiveKvarh = reactiveCurrent - reactivePrevious;
  if (!allowNegative && (activeKwh < 0 || reactiveKvarh < 0)) {
    throw new Error("Angka meter saat ini tidak boleh lebih kecil dari angka meter sebelumnya.");
  }

  const reactiveLimitKvarh = activeKwh * PLN_REACTIVE_RATIO;
  const marginKvarh = reactiveLimitKvarh - reactiveKvarh;
  const apparentEnergy = Math.hypot(activeKwh, reactiveKvarh);
  const powerFactor = apparentEnergy === 0 ? 1 : activeKwh / apparentEnergy;
  const hasReactivePenaltyRisk = reactiveKvarh > reactiveLimitKvarh;

  return {
    activeKwh,
    reactiveKvarh,
    reactiveLimitKvarh,
    marginKvarh,
    excessReactiveKvarh: Math.max(0, -marginKvarh),
    powerFactor,
    conclusion: hasReactivePenaltyRisk ? "POTENSI DENDA" : "AMAN",
  };
}

function jakartaDateParts(value) {
  if (value instanceof Date || (typeof value === "string" && /T|Z|[+-]\d\d:\d\d$/.test(value))) {
    const date=value instanceof Date?value:new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
        timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit",
      }).formatToParts(date).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
      return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day)};
    }
  }
  const text=String(value||"").trim();
  let match=text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3])};
  match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match?{year:Number(match[3]),month:Number(match[2]),day:Number(match[1])}:null;
}

export function summarizeMonthlyReactiveEnergy(checks,{year=new Date().getFullYear(),now=new Date()}={}) {
  const selectedYear=Number(year);
  const today=jakartaDateParts(now);
  const summaries=INDONESIAN_MONTH_LABELS.map((label,index)=>({
    year:selectedYear,month:index+1,label,activeKwh:0,reactiveKvarh:0,
    reactiveLimitKvarh:0,excessReactiveKvarh:0,powerFactor:1,
    conclusion:"AMAN",checkCount:0,lastEntryDay:null,isPartial:Boolean(today&&today.year===selectedYear&&today.month===index+1),
  }));

  for (const check of checks||[]) {
    const parts=jakartaDateParts(check.checked_at??check.tanggal);
    if (!parts||parts.year!==selectedYear||parts.month<1||parts.month>12) continue;
    let assessment;
    try { assessment=calculateElectricityAssessment(check); }
    catch { continue; }
    const summary=summaries[parts.month-1];
    summary.activeKwh+=assessment.activeKwh;
    summary.reactiveKvarh+=assessment.reactiveKvarh;
    summary.checkCount+=1;
    summary.lastEntryDay=Math.max(summary.lastEntryDay||0,parts.day);
  }

  return summaries.map(summary=>{
    const reactiveLimitKvarh=summary.activeKwh*PLN_REACTIVE_RATIO;
    const apparentEnergy=Math.hypot(summary.activeKwh,summary.reactiveKvarh);
    const excessReactiveKvarh=Math.max(0,summary.reactiveKvarh-reactiveLimitKvarh);
    return {...summary,reactiveLimitKvarh,excessReactiveKvarh,
      powerFactor:apparentEnergy===0?1:summary.activeKwh/apparentEnergy,
      conclusion:summary.reactiveKvarh>reactiveLimitKvarh?"POTENSI DENDA":"AMAN",
    };
  });
}
