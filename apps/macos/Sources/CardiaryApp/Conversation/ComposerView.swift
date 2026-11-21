import CardiaryKit
import SwiftUI

/// 輸入框：送出、選擇排隊或插話，以及中斷目前回合。整個輸入區是一塊圓角色塊。
struct ComposerView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var conversation: ConversationModel
    @Environment(\.cardiaryScale) private var uiScale

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            if let error = conversation.errorMessage {
                messageBar(error, systemImage: "exclamationmark.triangle.fill", tone: .red)
            }
            if let notice = conversation.noticeMessage {
                messageBar(notice, systemImage: "info.circle.fill", tone: .gray)
            }

            VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                TextField(
                    AppL10n.text(.conversationInputPlaceholder),
                    text: $conversation.composerText,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .cardiaryFont(.body)
                .lineLimit(1...8)
                .frame(minHeight: 22, alignment: .top)
                .onSubmit {
                    Task { await conversation.send() }
                }

                HStack(spacing: DesignTokens.spacingS) {
                    ThemeSegmented(
                        selection: $conversation.delivery,
                        options: [
                            (DeliveryMode.queue, AppL10n.text(.conversationDeliveryQueue)),
                            (DeliveryMode.steer, AppL10n.text(.conversationDeliverySteer)),
                        ]
                    )
                    .fixedSize()
                    .help(AppL10n.text(.conversationDeliveryQueue) + " / " + AppL10n.text(.conversationDeliverySteer))

                    Spacer()

                    if conversation.isBusy {
                        Button {
                            Task { await conversation.interrupt() }
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.system(size: 11, weight: .bold))
                        }
                        .buttonStyle(ThemeIconButtonStyle(fill: Palette.redSoft, foreground: Palette.redInk, diameter: 32))
                        .help(AppL10n.text(.conversationInterrupt))
                    }

                    Button {
                        Task { await conversation.send() }
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                    }
                    .buttonStyle(ThemeIconButtonStyle(fill: Palette.red, foreground: Palette.onAccent, diameter: 32))
                    .disabled(conversation.isSending || !model.isServiceAvailable)
                    .help(AppL10n.text(.conversationSend))
                    .accessibilityLabel(AppL10n.text(.conversationSend))
                }
            }
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.top, DesignTokens.spacingM)
            .padding(.bottom, DesignTokens.spacingS)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
        }
        .frame(maxWidth: DesignTokens.transcriptMaxWidth * max(1.0, uiScale))
        .padding(.horizontal, DesignTokens.spacingL)
        .padding(.bottom, DesignTokens.spacingL)
        .padding(.top, DesignTokens.spacingXS)
        .frame(maxWidth: .infinity)
    }

    private func messageBar(_ text: String, systemImage: String, tone: Tone) -> some View {
        HStack(spacing: DesignTokens.spacingS) {
            MessageBanner(text: text, systemImage: systemImage, tone: tone)
            Button {
                conversation.dismissMessages()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(ThemeIconButtonStyle(diameter: 22))
        }
    }
}
