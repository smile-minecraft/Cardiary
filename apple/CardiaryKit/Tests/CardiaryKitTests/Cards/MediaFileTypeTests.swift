import XCTest

@testable import CardiaryKit

final class MediaFileTypeTests: XCTestCase {
    func testCommonImageAndAudioExtensions() {
        XCTAssertEqual(MediaFileType.mediaType(forPathExtension: "PNG"), "image/png")
        XCTAssertEqual(MediaFileType.mediaType(forPathExtension: "jpeg"), "image/jpeg")
        XCTAssertEqual(MediaFileType.mediaType(forPathExtension: "m4a"), "audio/mp4")
        XCTAssertEqual(MediaFileType.mediaType(forPathExtension: "wav"), "audio/wav")
    }

    func testUnsupportedExtensionsReturnNil() {
        XCTAssertNil(MediaFileType.mediaType(forPathExtension: "pdf"))
        XCTAssertNil(MediaFileType.mediaType(forPathExtension: ""))
        XCTAssertNil(MediaFileType.mediaType(for: URL(fileURLWithPath: "/tmp/notes.md")))
    }

    func testFileURLUsesPathExtension() {
        XCTAssertEqual(
            MediaFileType.mediaType(for: URL(fileURLWithPath: "/tmp/photo.HEIC")),
            "image/heic"
        )
        XCTAssertTrue(MediaFileType.isSupported(URL(fileURLWithPath: "/tmp/voice.caf")))
    }
}
