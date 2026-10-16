/** Formulário V5.16 de apoio, somente no detalhe aberto da Guarda.
 * Não acessa sessão, rede ou dados da conta; confirmação significa REGISTRO, não despacho.
 */
import {useRef,useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {
 GUARD_SUPPORT_REASONS_V516,
 type GuardSupportReasonV516,type GuardSupportActionsV516
} from "./guard-support-actions-v516.ts";

type Props=Readonly<{protocolId:string;actions:GuardSupportActionsV516;disabled:boolean}>;
export default function GuardSupportPanelV516({protocolId,actions,disabled}:Props){
 const [open,setOpen]=useState(false);
 const [reason,setReason]=useState<GuardSupportReasonV516>(GUARD_SUPPORT_REASONS_V516[0]);
 const [note,setNote]=useState("");
 const [busy,setBusy]=useState(false);
 const busyRef=useRef(false);
 const [retryLocked,setRetryLocked]=useState(false);
 const [recorded,setRecorded]=useState(false);
 const [message,setMessage]=useState("");
 const send=async()=>{
  if(disabled||busyRef.current||recorded)return;
  busyRef.current=true;setBusy(true);setMessage("");
  try{
   await actions.submit(protocolId,reason,note);
   setRecorded(true);setRetryLocked(false);
   setMessage("Pedido registrado para consulta pela administração SEMUS.");
  }catch{
   // Após perda de ACK, os mesmos dados devem ser reenviados com o mesmo UUID.
   setRetryLocked(true);
   setMessage("Não foi possível confirmar o registro. Tente novamente sem alterar os dados.");
  }finally{busyRef.current=false;setBusy(false);}
 };
 if(!open)return <Pressable accessibilityRole="button" disabled={disabled}
   accessibilityState={{disabled}} style={styles.action} onPress={()=>setOpen(true)}>
   <Text style={styles.actionText}>Solicitar apoio</Text>
  </Pressable>;
 return <View style={styles.panel}>
  <Text style={styles.title}>Solicitar apoio</Text>
  {recorded?<Text accessibilityRole="alert" style={styles.success}>{message}</Text>:<>
   <Text style={styles.label}>Motivo</Text>
   {GUARD_SUPPORT_REASONS_V516.map(choice=>
    <Pressable key={choice} accessibilityRole="radio"
     accessibilityState={{checked:reason===choice,disabled:disabled||busy||retryLocked}}
     disabled={disabled||busy||retryLocked}
     style={[styles.choice,reason===choice&&styles.active]}
     onPress={()=>setReason(choice)}>
     <Text style={styles.choiceText}>{reason===choice?"●  ":"○  "}{choice}</Text>
    </Pressable>)}
   <Text style={styles.label}>Observação</Text>
   <TextInput multiline accessibilityLabel="Observação do pedido de apoio"
    editable={!disabled&&!busy&&!retryLocked} maxLength={2000}
    style={styles.input} value={note} onChangeText={setNote}
    placeholder="Descreva a necessidade de apoio"
    placeholderTextColor="#6b7a75"/>
   <Pressable accessibilityRole="button" disabled={disabled||busy}
    accessibilityState={{disabled:disabled||busy}} style={styles.action}
    onPress={()=>void send()}>
    <Text style={styles.actionText}>{retryLocked?"Repetir pedido":"Enviar pedido de apoio"}</Text>
   </Pressable>
   {busy&&<ActivityIndicator accessibilityLabel="Registrando pedido de apoio"/>}
   {message!==""&&<Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
   {!retryLocked&&<Pressable accessibilityRole="button" disabled={disabled||busy}
     onPress={()=>setOpen(false)}><Text style={styles.cancel}>Cancelar</Text></Pressable>}
  </>}
 </View>;
}
const styles=StyleSheet.create({
 panel:{gap:10,padding:14,borderWidth:1,borderColor:"#d7e5dd",borderRadius:12,backgroundColor:"#f9fcfa"},
 title:{fontWeight:"700",fontSize:17,color:"#174c45"},
 label:{fontWeight:"600",color:"#24453a"},
 choice:{padding:11,backgroundColor:"#edf3ef",borderRadius:8},
 active:{backgroundColor:"#c8e4d6"},
 choiceText:{color:"#174c45"},
 input:{minHeight:92,textAlignVertical:"top",backgroundColor:"#fff",
  borderWidth:1,borderColor:"#bbcfc4",borderRadius:9,padding:12,color:"#172e27"},
 action:{backgroundColor:"#075e59",padding:14,borderRadius:10},
 actionText:{color:"#fff",fontWeight:"700",textAlign:"center"},
 cancel:{color:"#075e59",fontWeight:"700"},
 error:{color:"#922a21"},
 success:{color:"#136442",fontWeight:"600"}
});
