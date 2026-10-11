/**
 * JeriFlow V5.16 — regras originais do ADM Turismo / Estacionamento.
 * Autoridade verificada NO ZIP original:
 * SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * admin-turismo/index.html: paidUntilDate(), stayState(), saveReg(),
 * saveExtension(), registerManualExit(), confirmTolerance().
 * NÃO é gateway de pagamento, não faz cobrança automática ou emite TTS.
 */
export const PARKING_V516_DAY_MS = 86_400_000;
export type ParkingStayStateV516 =
  "UPCOMING"|"PARKED"|"DUE_TODAY"|"OVERDUE"|"EXITED";
export class ParkingPolicyErrorV516 extends Error {
  readonly code:"INVALID_PARKING_INPUT"|"INVALID_PARKING_CHARGE"|
    "PARKING_EXIT_BLOCKED";
  constructor(code:ParkingPolicyErrorV516["code"]){super(code);this.code=code;}
}
function instant(value:unknown):number {
  if(typeof value!=="string"||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  const n=Date.parse(value);
  if(!Number.isFinite(n))throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  return n;
}
export function parkingPaidUntilV516(entryAt:string,paidDays:number):string{
  const start=instant(entryAt);
  if(!Number.isSafeInteger(paidDays)||paidDays<1||paidDays>3650)
    throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  const ms=start+paidDays*PARKING_V516_DAY_MS;
  if(!Number.isSafeInteger(ms))throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  return new Date(ms).toISOString();
}
export function parkingInitialCentsV516(
  days:number,dailyRateCents:number,prepaidAcknowledged:boolean
):number{
  if(!Number.isSafeInteger(days)||days<1||days>3650||
    !Number.isSafeInteger(dailyRateCents)||dailyRateCents<1||
    dailyRateCents>1_000_000)
    throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  if(days>1&&prepaidAcknowledged!==true)
    throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  const amount=days*dailyRateCents;
  if(!Number.isSafeInteger(amount))throw new ParkingPolicyErrorV516("INVALID_PARKING_CHARGE");
  return amount;
}
export function parkingStateV516(value:Readonly<{
  entryAt:string;paidDays:number;exitAt?:string|null;now:string;
}>):Readonly<{state:ParkingStayStateV516;paidUntil:string;overdueDays:number}>{
  const start=instant(value.entryAt);
  const now=instant(value.now);
  const until=parkingPaidUntilV516(value.entryAt,value.paidDays);
  const end=instant(until);
  if(value.exitAt!==undefined&&value.exitAt!==null){
    const exit=instant(value.exitAt);
    if(exit<start)throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
    if(exit<=now)return {state:"EXITED",paidUntil:until,overdueDays:0};
  }
  if(now<start)return {state:"UPCOMING",paidUntil:until,overdueDays:0};
  if(now>end)return {
    state:"OVERDUE",paidUntil:until,
    overdueDays:Math.max(1,Math.ceil((now-end)/PARKING_V516_DAY_MS))
  };
  if(new Date(now).toISOString().slice(0,10)===until.slice(0,10))
    return {state:"DUE_TODAY",paidUntil:until,overdueDays:0};
  return {state:"PARKED",paidUntil:until,overdueDays:0};
}
export function parkingExtendV516(value:Readonly<{
  entryAt:string;currentPaidDays:number;addDays:number;
  dailyRateCents:number;
}>):Readonly<{paidDays:number;addedCents:number;paidUntil:string}>{
  const {currentPaidDays,addDays,dailyRateCents}=value;
  if(!Number.isSafeInteger(addDays)||addDays<1||
    !Number.isSafeInteger(currentPaidDays)||
    currentPaidDays+addDays>3650)
    throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  const addedCents=parkingInitialCentsV516(addDays,dailyRateCents,true);
  return {paidDays:currentPaidDays+addDays,addedCents,
    paidUntil:parkingPaidUntilV516(value.entryAt,currentPaidDays+addDays)};
}
export function parkingNormalExitAllowedV516(value:Readonly<{
  entryAt:string;paidDays:number;exitAt:string;
  prepaidMultiDay:boolean;
}>):void{
  const exit=instant(value.exitAt);
  const start=instant(value.entryAt);
  if(exit<start)throw new ParkingPolicyErrorV516("INVALID_PARKING_INPUT");
  const paid=instant(parkingPaidUntilV516(value.entryAt,value.paidDays));
  if(exit>paid||(value.prepaidMultiDay&&exit<paid))
    throw new ParkingPolicyErrorV516("PARKING_EXIT_BLOCKED");
  // Exceção do coordenador e tolerância seguem fluxos separados.
}
