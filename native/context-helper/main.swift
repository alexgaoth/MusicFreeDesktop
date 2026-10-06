// context-helper — macOS signal helper for the MusicFree context engine.
//
// Writes one JSON object per line to stdout:
//   {"type":"app","bundleId":"com.apple.dt.Xcode","name":"Xcode","pid":123}
//   {"type":"mic","inUse":true}
//
// - "app": sent at start and every time another application becomes frontmost.
// - "mic": sent at start and every time the default input device starts or stops
//   being used by any process (kAudioDevicePropertyDeviceIsRunningSomewhere).
//
// Needs no permissions: no Accessibility, no Screen Recording, no microphone access
// (it reads device state only, never audio).
//
// Exits when stdin closes, so it never outlives the parent process.
//
// Build: swiftc -O native/context-helper/main.swift -o build/native/context-helper

import AppKit
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("[context-helper] \(message)\n".utf8))
}

// MARK: - Frontmost application

func emitApp(_ app: NSRunningApplication?) {
    guard let app = app else { return }
    emit([
        "type": "app",
        "bundleId": app.bundleIdentifier ?? "",
        "name": app.localizedName ?? "",
        "pid": Int(app.processIdentifier),
    ])
}

NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
) { note in
    emitApp(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
}

emitApp(NSWorkspace.shared.frontmostApplication)

// MARK: - Microphone in use

final class MicMonitor {
    private var deviceId = AudioObjectID(kAudioObjectUnknown)
    private var lastInUse: Bool?

    private var runningAddress = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    private var defaultInputAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    private lazy var runningListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        self?.check()
    }

    private lazy var defaultInputListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        self?.retarget()
        self?.check()
    }

    func start() {
        let status = AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject),
            &defaultInputAddress,
            DispatchQueue.main,
            defaultInputListener
        )
        if status != noErr {
            log("cannot listen for default input changes: \(status)")
        }
        retarget()
        check()

        // Safety net: some drivers do not post property notifications.
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.check()
        }
    }

    private func retarget() {
        let next = readDefaultInputDevice()
        if next == deviceId { return }

        if deviceId != kAudioObjectUnknown {
            AudioObjectRemovePropertyListenerBlock(
                deviceId, &runningAddress, DispatchQueue.main, runningListener)
        }
        deviceId = next
        if deviceId != kAudioObjectUnknown {
            let status = AudioObjectAddPropertyListenerBlock(
                deviceId, &runningAddress, DispatchQueue.main, runningListener)
            if status != noErr {
                log("cannot listen on input device \(deviceId): \(status)")
            }
        }
    }

    private func check() {
        let inUse = readIsRunningSomewhere()
        if inUse == lastInUse { return }
        lastInUse = inUse
        emit(["type": "mic", "inUse": inUse])
    }

    private func readDefaultInputDevice() -> AudioObjectID {
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &defaultInputAddress, 0, nil, &size, &id)
        return status == noErr ? id : AudioObjectID(kAudioObjectUnknown)
    }

    private func readIsRunningSomewhere() -> Bool {
        if deviceId == kAudioObjectUnknown { return false }
        var running: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(
            deviceId, &runningAddress, 0, nil, &size, &running)
        return status == noErr && running != 0
    }
}

let micMonitor = MicMonitor()
micMonitor.start()

// MARK: - Parent watchdog

// The parent keeps stdin open. EOF means the parent exited or closed the pipe.
Thread.detachNewThread {
    while true {
        let data = FileHandle.standardInput.availableData
        if data.isEmpty { exit(0) }
    }
}

RunLoop.main.run()
