import AuthApp from "../../packages/mobile-auth/AuthApp";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

async function pickEvidence(){
  const chosen=await DocumentPicker.getDocumentAsync({
    type:["image/jpeg","image/png","application/pdf"],multiple:false,copyToCacheDirectory:true
  });
  if(chosen.canceled)return null;
  const asset=chosen.assets[0];
  if(!asset||!asset.uri)return null;
  const file=new File(asset.uri);
  try{
    const size=file.size;
    if(size<32||size>1048576)throw new Error("INVALID_INPUT");
    const name=asset.name;
    const extension=name.toLowerCase().match(/\.(jpe?g|png|pdf)$/)?.[1];
    const mediaType=extension==="pdf"?"application/pdf":extension==="png"?"image/png":
      extension==="jpg"||extension==="jpeg"?"image/jpeg":"";
    if(!mediaType||typeof name!=="string"||name.length>80||name.includes("..")||
      !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(name))
      throw new Error("INVALID_INPUT");
    return {fileName:name,mediaType,sizeBytes:size,dataBase64:await file.base64()};
  }finally{
    // Picker copia o arquivo para o cache privado. Não reter evidências.
    try{file.delete()}catch{}
  }
}
export default function App(){return <AuthApp appId="cidadao" pickAttachment={pickEvidence}/>;}
