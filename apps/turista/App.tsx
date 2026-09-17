import { View, Text, StyleSheet } from "react-native";
export default function App() {
  return <View style={styles.container}>
    <Text style={styles.title}>JeriFlow Turista</Text>
    <Text>Ambiente de desenvolvimento — Etapa 2</Text>
    <Text>Base técnica. Funções operacionais ainda não implementadas.</Text>
    <Text>Não use dados reais.</Text>
  </View>;
}
const styles = StyleSheet.create({
 container: { flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: "#fff" },
 title: { fontSize: 26, fontWeight: "700", color: "#075e59" }
});
