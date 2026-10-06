import assert from "node:assert/strict";
import test from "node:test";
import { calculateElectricityAssessment, summarizeMonthlyReactiveEnergy } from "../src/lib/electricity.js";

test("aman ketika pemakaian reaktif di bawah ambang PLN", () => {
  const result = calculateElectricityAssessment({huhe_h:200,huhe_hh:100,huar_heh:50,huar_hh:10});
  assert.equal(result.activeKwh,100);
  assert.equal(result.reactiveLimitKvarh,62);
  assert.equal(result.reactiveKvarh,40);
  assert.equal(result.conclusion,"AMAN");
});

test("angka meter menerima pemisah desimal koma maupun titik", () => {
  const comma=calculateElectricityAssessment({huhe_h:"200,50",huhe_hh:"100,25",huar_heh:"50,50",huar_hh:"10,25"});
  const dot=calculateElectricityAssessment({huhe_h:"200.50",huhe_hh:"100.25",huar_heh:"50.50",huar_hh:"10.25"});
  assert.deepEqual(comma,dot);
});

test("tepat pada ambang 0,62 masih aman", () => {
  const result = calculateElectricityAssessment({huhe_h:200,huhe_hh:100,huar_heh:72,huar_hh:10});
  assert.equal(result.powerFactor.toFixed(3),"0.850");
  assert.equal(result.conclusion,"AMAN");
});

test("di atas ambang berpotensi denda", () => {
  const result = calculateElectricityAssessment({huhe_h:200,huhe_hh:100,huar_heh:73,huar_hh:10});
  assert.equal(result.excessReactiveKvarh,1);
  assert.equal(result.conclusion,"POTENSI DENDA");
});

test("menolak angka meter yang mundur", () => {
  assert.throws(
    () => calculateElectricityAssessment({huhe_h:99,huhe_hh:100,huar_heh:50,huar_hh:10}),
    /tidak boleh lebih kecil/,
  );
});

test("tetap dapat menilai data historis dengan meter mundur", () => {
  const result = calculateElectricityAssessment(
    {huhe_h:99,huhe_hh:100,huar_heh:50,huar_hh:10},
    {allowNegative:true},
  );
  assert.equal(result.activeKwh,-1);
  assert.equal(result.conclusion,"POTENSI DENDA");
});

test("data cos phi panel tidak memengaruhi perhitungan kVArh", () => {
  const meter={huhe_h:200,huhe_hh:100,huar_heh:50,huar_hh:10};
  const withoutPanel=calculateElectricityAssessment(meter);
  const withPanel=calculateElectricityAssessment({...meter,cos_phi:0.5,panel:"panel_1"});
  assert.deepEqual(withPanel,withoutPanel);
});

test("rekap kVArh memakai bulan kalender tanggal 1 sampai akhir bulan", () => {
  const data=summarizeMonthlyReactiveEnergy([
    {checked_at:"2026-04-01T08:00:00+07:00",huhe_h:150,huhe_hh:100,huar_heh:35,huar_hh:10},
    {checked_at:"2026-04-30T08:00:00+07:00",huhe_h:230,huhe_hh:150,huar_heh:70,huar_hh:35},
    {checked_at:"2026-05-01T08:00:00+07:00",huhe_h:250,huhe_hh:230,huar_heh:90,huar_hh:70},
  ],{year:2026,now:new Date("2026-05-14T10:00:00+07:00")});
  assert.equal(data[3].activeKwh,130);
  assert.equal(data[3].reactiveKvarh,60);
  assert.equal(data[3].reactiveLimitKvarh,80.6);
  assert.equal(data[3].checkCount,2);
  assert.equal(data[3].lastEntryDay,30);
  assert.equal(data[4].activeKwh,20);
  assert.equal(data[4].isPartial,true);
});

test("status bulanan berdasarkan total aktual terhadap batas 62 persen", () => {
  const [january]=summarizeMonthlyReactiveEnergy([
    {tanggal:"31/01/2026 08:00",huhe_h:200,huhe_hh:100,huar_heh:74,huar_hh:10},
  ],{year:2026,now:new Date("2026-02-01T00:00:00+07:00")});
  assert.equal(january.reactiveLimitKvarh,62);
  assert.equal(january.reactiveKvarh,64);
  assert.equal(january.excessReactiveKvarh,2);
  assert.equal(january.conclusion,"POTENSI DENDA");
  assert.equal(january.isPartial,false);
});

test("hanya mengambil 1 isian per hari: utamakan isian 1 jika berisi, fallback ke isian 2 jika isian 1 kosong", () => {
  const data=summarizeMonthlyReactiveEnergy([
    // Hari 1: Isian 1 (08:00) berisi, Isian 2 (16:00) juga berisi -> Ambil Isian 1 saja
    {checked_at:"2026-04-01T08:00:00+07:00",huhe_h:150,huhe_hh:100,huar_heh:35,huar_hh:10}, // active=50, reactive=25
    {checked_at:"2026-04-01T16:00:00+07:00",huhe_h:200,huhe_hh:150,huar_heh:60,huar_hh:35}, // active=50, reactive=25

    // Hari 2: Isian 1 (08:00) kosong (0/0), Isian 2 (16:00) berisi -> Fallback ke Isian 2
    {checked_at:"2026-04-02T08:00:00+07:00",huhe_h:200,huhe_hh:200,huar_heh:60,huar_hh:60}, // active=0, reactive=0
    {checked_at:"2026-04-02T16:00:00+07:00",huhe_h:240,huhe_hh:200,huar_heh:80,huar_hh:60}, // active=40, reactive=20
  ],{year:2026,now:new Date("2026-05-14T10:00:00+07:00")});

  // Total bulan April: Hari 1 (50 kWh, 25 kVArh) + Hari 2 (40 kWh, 20 kVArh) = 90 kWh, 45 kVArh
  assert.equal(data[3].activeKwh, 90);
  assert.equal(data[3].reactiveKvarh, 45);
});
