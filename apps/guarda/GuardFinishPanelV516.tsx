/** V5.16 Guarda — formulário de conclusão, somente na prévia autenticada.
 * Itens reproduzidos de guarda-semus/index.html; sem upload de fotos.
 * O backend e a autorização são fornecidos pelo chamador, nunca por esta tela.
 */
import {useState} from "react";
import {Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {
 GUARD_RESULTS_V516,GUARD_ACTIONS_V516,
 type GuardResultV516,type GuardActionV516
} from "./guard-service-v516.ts";

export type GuardFinishFormV516=Readonly<{
 result:GuardResultV516;action:GuardActionV516;note:string;
}>;
export default function GuardFinishPanelV516({disabled,onConfirm}:Readonly<{
 disabled:boolean;onConfirm:(data:GuardFinishFormV516)=>Promise<void>;
}>){
 const [result,setResult]=useState<GuardResultV516>(GUARD_RESULTS_V516[0]);
 const [action,setAction]=useState<GuardActionV516>(GUARD_ACTIONS_V516[0]);
 const [note,setNote]=useState("");
 const [confirm,setConfirm]=useState(false);
 return <View style={styles.container}>
  <Text style={styles.header}>Resultado da verificação</Text>
  <Text style={styles.label}>Situação encontrada</Text>
  {GUARD_RESULTS_V516.map(item=><Pressable key={item} accessibilityRole="radio"
    accessibilityState={{checked:item===result,disabled}} disabled={disabled}
    onPress={()=>{setResult(item);setConfirm(false);}} style={[styles.choice,item===result&&styles.selected]}>
    <Text style={styles.choiceText}>{item===result?"◉ ":"○ "}{item}</Text>
   </Pressable>)}
  <Text style={styles.label}>Providência</Text>
  {GUARD_ACTIONS_V516.map(item=><Pressable key={item} accessibilityRole="radio"
    accessibilityState={{checked:item===action,disabled}} disabled={disabled}
    onPress={()=>{setAction(item);setConfirm(false);}} style={[styles.choice,item===action&&styles.selected]}>
    <Text style={styles.choiceText}>{item===action?"◉ ":"○ "}{item}</Text>
   </Pressable>)}
  <Text style={styles.label}>Observação</Text>
  <TextInput multiline editable={!disabled} value={note} maxLength={2000}
    accessibilityLabel="Observação do atendimento" placeholder="Registre somente o necessário..."
    onChangeText={v=>{setNote(v);setConfirm(false);}}
    style={styles.input}/>
  <Text style={styles.hint}>O envio de fotos e evidências exige homologação separada. Não envie dados reais nesta prévia.</Text>
  {confirm&&<Text accessibilityRole="alert" style={styles.warning}>
   Confirma finalizar a ocorrência com esta situação e providência? Após o envio, ela será marcada como finalizada.
  </Text>}
  <Pressable disabled={disabled} accessibilityRole="button"
    style={[styles.button,disabled&&styles.disabled]} onPress={()=>{
      if(!confirm){setConfirm(true);return;}
      void onConfirm({result,action,note});
    }}>
    <Text style={styles.buttonText}>{confirm?"Confirmar finalização":"Revisar finalização"}</Text>
  </Pressable>
  {confirm&&<Pressable disabled={disabled} accessibilityRole="button"
    onPress={()=>setConfirm(false)}><Text style={styles.cancel}>Cancelar finalização</Text></Pressable>}
 </View>;
}
const styles=StyleSheet.create({
 container:{gap:10,paddingTop:12},
 header:{fontSize:18,fontWeight:"700",color:"#174c45"},
 label:{fontSize:15,fontWeight:"700",color:"#174c45",marginTop:10},
 choice:{borderWidth:1,borderColor:"#cadbd0",padding:10,borderRadius:8},
 selected:{backgroundColor:"#dceee4",borderColor:"#075e59"},
 choiceText:{fontSize:14,color:"#183c35"},
 input:{minHeight:90,borderWidth:1,borderColor:"#cadbd0",borderRadius:8,
 backgroundColor:"#fff",textAlignVertical:"top",padding:12,color:"#183c35"},
 hint:{fontSize:12,color:"#58685f"},
 warning:{color:"#813225",fontSize:14},
 button:{padding:14,backgroundColor:"#075e59",borderRadius:10,alignItems:"center"},
 disabled:{opacity:0.5},buttonText:{color:"#fff",fontWeight:"700"},cancel:{color:"#075e59",textAlign:"center",padding:10}
});
