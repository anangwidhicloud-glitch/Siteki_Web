import test from "node:test";
import assert from "node:assert/strict";
import { calculatePartArrival } from "../worker/handlers/data.js";

test("kedatangan sebagian tetap Open dan menyimpan sisa",()=>{
  assert.deepEqual(calculatePartArrival(2,0,1,false),{
    totalArrived:1,remainingQuantity:1,fulfilled:false,shouldClose:false,
  });
});

test("kedatangan berikutnya diakumulasi sampai Close",()=>{
  assert.deepEqual(calculatePartArrival(2,1,1,false),{
    totalArrived:2,remainingQuantity:0,fulfilled:true,shouldClose:true,
  });
});

test("bon ulang menutup item lama tetapi mempertahankan sisa",()=>{
  assert.deepEqual(calculatePartArrival(5,1,2,true),{
    totalArrived:3,remainingQuantity:2,fulfilled:false,shouldClose:true,
  });
});
