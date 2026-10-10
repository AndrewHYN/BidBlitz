import { describe,expect,it } from "vitest";
import { prepareCost, nextCostStatuses } from "./costs";

const input = {description:"Staff support shift",category:"PAYROLL",payee:"Part time support",amountUsd:"32.50",incurredOn:"2026-10-10"};
describe("company cost rules",()=>{
 it("stores payroll costs in exact integer cents",()=>{
  expect(prepareCost(input)).toMatchObject({amountMinor:3250,category:"PAYROLL"});
 });
 it("denies negative, sub-cent or implausible values",()=>{
  expect(prepareCost({...input,amountUsd:"1.001"})).toBeNull();
  expect(prepareCost({...input,amountUsd:"-8"})).toBeNull();
  expect(prepareCost({...input,amountUsd:"1000000.01"})).toBeNull();
 });
 it("denies malformed calendar dates",()=>{
  expect(prepareCost({...input,incurredOn:"2026-02-30"})).toBeNull();
 });
 it("treats paid and voided as terminal",()=>{
  expect(nextCostStatuses("PLANNED")).toEqual(["INCURRED","VOIDED"]);
  expect(nextCostStatuses("INCURRED")).toEqual(["PAID","VOIDED"]);
  expect(nextCostStatuses("PAID")).toEqual([]);
  expect(nextCostStatuses("VOIDED")).toEqual([]);
 });
});
