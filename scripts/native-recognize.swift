import Foundation
import Vision

// Executado somente no runner macOS. OCR local, sem enviar imagens a serviços.
guard CommandLine.arguments.count == 2 else {
    fputs("Uso: native-recognize screenshot.png\n", stderr)
    exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["pt-BR", "en-US"]
let handler = VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1]), options: [:])
do {
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let data = try JSONSerialization.data(withJSONObject: lines)
    FileHandle.standardOutput.write(data)
} catch {
    fputs("Falha ao reconhecer a tela: \(error)\n", stderr)
    exit(1)
}
