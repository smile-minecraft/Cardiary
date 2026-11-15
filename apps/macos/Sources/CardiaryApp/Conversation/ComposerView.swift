import CardiaryKit
import SwiftUI

/// 輸入框：送出、選擇排隊或插話，以及中斷目前回合。
struct ComposerView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var conversation: ConversationModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            if let error = conversation.errorMessage {
                messageBar(error, systemImage: "exclamationmark.triangle", tint: .red)
            }
            if let notice = conversation.noticeMessage {
                messageBar(notice, systemImage: "info.circle", tint: .secondary)
            }

            HStack(alignment: .bottom, spacing: DesignTokens.spacingS) {
                TextField(
                    AppL10n.text(.conversationInputPlaceholder),
                    text: $conversation.composerText,
                    axis: .vertical
                )
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...8)
                .frame(minHeight: DesignTokens.composerMinHeight, alignment: .top)
                .onSubmit {
                    Task { await conversation.send() }
                }

                Picker("", selection: $conversation.delivery) {
                    Text(AppL10n.text(.conversationDeliveryQueue)).tag(DeliveryMode.queue)
                    Text(AppL10n.text(.conversationDeliverySteer)).tag(DeliveryMode.steer)
                }
                .labelsHidden()
                .frame(width: 96)
                .help(AppL10n.text(.conversationDeliveryQueue) + " / " + AppL10n.text(.conversationDeliverySteer))

                if conversation.isBusy {
                    Button {
                        Task { await conversation.interrupt() }
                    } label: {
                        Image(systemName: "stop.circle")
                    }
                    .help(AppL10n.text(.conversationInterrupt))
                }

                Button {
                    Task { await conversation.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .buttonStyle(.borderless)
                .disabled(conversation.isSending || !model.isServiceAvailable)
                .help(AppL10n.text(.conversationSend))
            }
        }
        .padding(DesignTokens.spacingM)
    }

    private func messageBar(_ text: String, systemImage: String, tint: Color) -> some View {
        HStack(spacing: DesignTokens.spacingXS) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text(text)
                .font(.caption)
                .foregroundStyle(tint)
            Spacer()
            Button {
                conversation.dismissMessages()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2)
            }
            .buttonStyle(.borderless)
        }
    }
}
