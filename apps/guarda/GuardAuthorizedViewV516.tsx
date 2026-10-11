/** JeriFlow V5.16 — área operacional Guarda em estágio isolado.
 * Original ZIP SHA256: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * Não montado em App.tsx/AuthApp.tsx; sem permissão não renderiza a fila.
 */
import {useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from "react-native";
import type {IdentityContext} from "../../packages/contracts/src/identity.ts";
import type {Transport} from "../../packages/auth/client.ts";
import {guardAuthorizedActionsV516,guardEligibleMunicipalitiesV516} from "./guard-access-gate-v516.ts";
import GuardQueueScreenV516,{type GuardScreenActionsV516} from "./GuardQueueScreenV516.tsx";
type Props=Readonly<{context:IdentityContext;transport:Transport;newRequestId:()=>string}>;
export default function GuardAuthorizedViewV516({context,transport,newRequestId}:Props){
 const municipalities=guardEligibleMunicipalitiesV516(context);
 const [chosen,setChosen]=useState("");
 const [grant,setGrant]=useState<{mid:string;actions:GuardScreenActionsV516}|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const generation=useRef(0);
 // Invalidar a permissão visual na troca de sessão/vínculo, inclusive antes do efeito.
 const eligible=municipalities.some(m=>m.id===chosen);
 useEffect(()=>{generation.current++;setChosen("");setGrant(null);setMessage("");},[context,transport]);
 const authorized=eligible&&grant?.mid===chosen&&!busy&&context.security.nextStep==="ready";
 async function select(mid:string){
  if(busy||!municipalities.some(m=>m.id===mid))return;
  const current=++generation.current;
  setChosen(mid);setGrant(null);setBusy(true);setMessage("");
  try{
   const actions=await guardAuthorizedActionsV516(transport,context,mid,newRequestId);
   // A navegação só se abre após resposta bem-sucedida de /access.
   if(current===generation.current)setGrant({mid,actions});
  }catch{if(current===generation.current){setMessage("Não foi possível confirmar seu acesso. Tente novamente.");setGrant(null);}}
  finally{if(current===generation.current)setBusy(false);}
 }
 if(authorized&&grant)return <GuardQueueScreenV516 actions={grant.actions}/>;
 return <View style={styles.container}>
  <Text style={styles.title}>Guarda / SEMUS</Text>
  <Text style={styles.subtitle}>Selecione o município para consultar os atendimentos.</Text>
  {municipalities.length===0&&<Text style={styles.message}>Sua conta não tem acesso à Guarda neste município.</Text>}
  {municipalities.map(m=><Pressable key={m.id} accessibilityRole="button"
   disabled={busy} accessibilityState={{disabled:busy}}
   style={styles.button} onPress={()=>void select(m.id)}>
   <Text style={styles.buttonText}>{m.displayName}</Text></Pressable>)}
  {busy&&<ActivityIndicator accessibilityLabel="Verificando autorização"/>}
  {message!==""&&<Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
 </View>;
}
const styles=StyleSheet.create({
 container:{flex:1,backgroundColor:"#f6f5ef",padding:20,gap:16},
 title:{fontSize:24,fontWeight:"700",color:"#174c45"},
 subtitle:{color:"#354e47",fontSize:15},
 button:{backgroundColor:"#075e59",borderRadius:10,padding:16},
 buttonText:{color:"#fff",fontWeight:"700"},
 message:{color:"#813225",fontSize:14}
});
