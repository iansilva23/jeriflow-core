/**
 * JeriFlow V5.16 — voucher imprimível do estacionamento, SOMENTE para uso
 * interno após autenticação do ADM Turismo e leitura de dados do PostgreSQL.
 * Fonte: admin-turismo/index.html parkingVoucherHtml(), voucherEsc(),
 * voucherPaymentHistory(), voucherStatus() e regras de saída.
 * ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 *
 * Não é endpoint, pagamento, documento fiscal, comprovante da TTS ou
 * autorização automática de transporte. Não imprime sem dados consistentes.
 */
export type ParkingVoucherRegistrationV516=Readonly<{
 id:string;plate:string;brand:string;model:string;vehicleYear:number;
 responsibleName:string;document:string;phone:string;
 tourists:readonly string[];lodging:string;entryAt:string;paidUntil:string;
 paidDays:number;dailyRateCents:number;totalPaidCents:number|string;
 prepaidMultiDay:boolean;manualExitAt:string|null;
}>;
export type ParkingVoucherPaymentV516=Readonly<{
 kind:"INITIAL"|"EXTENSION";addedDays:number;amountCents:number|string;
 method:"PIX"|"CREDITO"|"DEBITO"|"DINHEIRO"|"OUTRO";
}>;
export class ParkingVoucherErrorV516 extends Error {
 readonly code="INVALID_PARKING_VOUCHER";
 constructor(){super("INVALID_PARKING_VOUCHER");}
}
const TOKEN=/^JFPK-(?:[A-HJ-NP-Z2-9]{5}-){4}[A-HJ-NP-Z2-9]{6}$/;
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,
 c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]??c));
function date(value:unknown):number{
 if(typeof value!=="string"||
   !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
   throw new ParkingVoucherErrorV516();
 const n=Date.parse(value);
 if(!Number.isFinite(n))throw new ParkingVoucherErrorV516();
 return n;
}
function cents(value:unknown):number{
 if(typeof value!=="number"&&
   (typeof value!=="string"||!/^\d{1,15}$/.test(value)))
   throw new ParkingVoucherErrorV516();
 const num=Number(value);
 if(!Number.isSafeInteger(num)||num<0)throw new ParkingVoucherErrorV516();
 return num;
}
const money=(n:number)=>new Intl.NumberFormat("pt-BR",{
 style:"currency",currency:"BRL"
}).format(n/100);
const when=(ms:number)=>new Intl.DateTimeFormat("pt-BR",{
 timeZone:"America/Fortaleza",dateStyle:"short",timeStyle:"short"
}).format(new Date(ms));
const localDay=(ms:number)=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"America/Fortaleza",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date(ms));

export function createParkingVoucherHtmlV516(input:Readonly<{
 registration:ParkingVoucherRegistrationV516;
 payments:readonly ParkingVoucherPaymentV516[];
 accessToken:string;
 printedAt:string;
}>):string{
 const r=input?.registration;
 if(!r||typeof input.accessToken!=="string"||!TOKEN.test(input.accessToken)
    ||!Array.isArray(input.payments)||input.payments.length<1
    ||!r.id||!r.plate||!r.brand||!r.model||!r.lodging||
    !r.responsibleName||!Array.isArray(r.tourists)||
    r.tourists.length<1||r.tourists.some(n=>typeof n!=="string"||!n.trim())||
    !Number.isSafeInteger(r.vehicleYear)||r.vehicleYear<1950||
    !Number.isSafeInteger(r.paidDays)||r.paidDays<1||r.paidDays>3650||
    !Number.isSafeInteger(r.dailyRateCents)||r.dailyRateCents<1)
    throw new ParkingVoucherErrorV516();
 const entry=date(r.entryAt),until=date(r.paidUntil),printed=date(input.printedAt);
 const exit=r.manualExitAt===null?null:date(r.manualExitAt);
 if(until-entry!==r.paidDays*86400000||exit!==null&&exit<entry||
    r.prepaidMultiDay&&r.paidDays<2)
   throw new ParkingVoucherErrorV516();
 const amounts=input.payments.map(m=>{
   if((m.kind!=="INITIAL"&&m.kind!=="EXTENSION")||
      !Number.isSafeInteger(m.addedDays)||m.addedDays<1||
      !["PIX","CREDITO","DEBITO","DINHEIRO","OUTRO"].includes(m.method))
     throw new ParkingVoucherErrorV516();
   const amount=cents(m.amountCents);
   if(amount!==m.addedDays*r.dailyRateCents)
     throw new ParkingVoucherErrorV516();
   return amount;
 });
 const total=amounts.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(total)||total!==cents(r.totalPaidCents)||
    input.payments[0].kind!=="INITIAL"||
    input.payments.slice(1).some(m=>m.kind!=="EXTENSION")||
    input.payments.reduce((a,b)=>a+b.addedDays,0)!==r.paidDays)
   throw new ParkingVoucherErrorV516();
 let status:string;
 if(exit!==null&&exit<=printed)status="SAÍDA REGISTRADA";
 else if(printed<entry)status="AGENDADO";
 else if(printed>until)status="PENDÊNCIA • PERÍODO PAGO ENCERRADO";
 else if(localDay(printed)===localDay(until))status="VENCE HOJE";
 else status="ESTACIONADO";
 const line=(label:string,value:string)=>
   '<div class="line"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';
 const tourists=r.tourists.map(n=>'<span class="guest">'+esc(n)+'</span>').join("");
 const payments=input.payments.map((p,i)=>
   "<tr><td>"+esc(i===0?"Pagamento inicial":"Diária(s) adicional(is) +"+p.addedDays)+
   "</td><td>"+p.addedDays+"</td><td>"+esc(p.method)+
   "</td><td>"+esc(money(amounts[i]))+"</td></tr>").join("");
 const prepaid=r.prepaidMultiDay?
   '<section class="notice"><b>Pagamento antecipado</b><p>Se sair antes do término das diárias pagas antecipadamente, não há reembolso automático.</p></section>':"";
 const exitInfo=exit===null?"":line("Saída registrada",when(exit));
 return [
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Voucher de estacionamento '+esc(r.id)+'</title>',
  '<style>@page{margin:9mm}*{box-sizing:border-box}',
  'body{font-family:Arial,Helvetica,sans-serif;color:#183e43;background:#fff;margin:0}',
  'main{margin:0 auto;max-width:750px;border:1.5px solid #154e51;border-radius:14px;overflow:hidden}',
  'header{background:#083c43;color:#fff;padding:20px}',
  'header strong{font-size:24px}header small{display:block;margin-top:4px;letter-spacing:.12em}',
  'section{margin:14px;padding:10px;border:1px solid #d8e7e5;border-radius:12px}',
  'h2{font-size:11px;letter-spacing:.08em;color:#127c77;margin:0 0 9px}',
  '.line{display:flex;justify-content:space-between;gap:15px;border-bottom:1px solid #ebf2f0;padding:5px 0;font-size:11px}',
  '.line span{color:#5c777c}.line b{text-align:right;overflow-wrap:anywhere}',
  '.guest{display:inline-block;background:#eaf5f3;margin:4px;padding:6px;border-radius:12px;font-size:10px}',
  'table{width:100%;border-collapse:collapse;font-size:10px}',
  'td,th{padding:7px;border-bottom:1px solid #e5efed;text-align:left}td:last-child,th:last-child{text-align:right}',
  '.token{padding:13px;text-align:center;background:#eff9f7;border:2px dashed #128d82}',
  '.token strong{font-family:monospace;font-size:16px;overflow-wrap:anywhere}',
  '.notice{background:#fff5df}.notice p,footer{font-size:10px;line-height:1.5}',
  'footer{padding:13px 17px;border-top:1px solid #dde7e5}',
  '@media print{main{max-width:none;border:1px solid #154e51}body{print-color-adjust:exact}}</style>',
  '</head><body><main>',
  '<header><strong>JeriFlow</strong><small>ESTACIONAMENTO • JERICOACOARA</small>',
  '<p>VOUCHER • VIA DO CLIENTE</p><small>Controle: '+esc(r.id)+'</small>',
  '<small>Impresso em: '+esc(when(printed))+'</small></header>',
  '<section><h2>CLIENTE E HOSPEDAGEM</h2>',
  line("Responsável",r.responsibleName),
  line("Documento",r.document),
  line("Telefone",r.phone),
  line("Hospedagem",r.lodging),'</section>',
  '<section><h2>VEÍCULO E SITUAÇÃO</h2>',
  line("Placa",r.plate),
  line("Marca / modelo",r.brand+" "+r.model),
  line("Ano",String(r.vehicleYear)),line("Situação",status),exitInfo,'</section>',
  '<section><h2>PERMANÊNCIA</h2>',
  line("Entrada",when(entry)),line("Diárias pagas",String(r.paidDays)),
  line("Valor da diária",money(r.dailyRateCents)),
  line("Pago até",when(until)),'</section>',
  '<section><h2>TURISTAS VINCULADOS</h2>',tourists,'</section>',
  '<section><h2>PAGAMENTOS REGISTRADOS DO ESTACIONAMENTO</h2>',
  '<table><thead><tr><th>Descrição</th><th>Diárias</th><th>Forma</th><th>Valor</th></tr></thead><tbody>',
  payments,'</tbody></table>',line("Total efetivamente recebido",money(total)),'</section>',
  '<section class="token"><h2>CHAVE DE ACESSO • APP TURISTA</h2>',
  '<strong>'+esc(input.accessToken)+'</strong>',
  '<p>Informe a chave no App Turista para consultar este estacionamento.</p></section>',
  prepaid,
  '<section class="notice"><b>Na saída apresente este voucher.</b>',
  '<p>A permanência não termina automaticamente quando a diária vence. Somente a saída física registrada encerra a ocupação.</p></section>',
  '<section><b>TTS independente</b><p>Este voucher não substitui autorização ou documento oficial da TTS. Pagamentos do estacionamento não conferem aprovação da TTS.</p></section>',
  '<footer>JeriFlow • Estacionamento. Este voucher não é documento fiscal.</footer>',
  '</main></body></html>'
 ].join("");
}
