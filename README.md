# NoteFall

Biến bản nhạc piano thành **nốt pha lê rơi xuống đúng phím**, soạn nhạc như MuseScore, rồi xuất thành video. Chạy trên Mac, Windows và iPad.

## Làm được gì

- **Nốt rơi**: mở PDF bản nhạc, MIDI, MP3, WAV hoặc FLAC; nốt rơi xuống đúng 88 phím, phím lún và sáng khi nốt chạm. Ba giao diện: Đen, Pha lê, Ảnh của bạn.
- **Soạn nhạc**: trình soạn bản nhạc hai khuông, nhiều giọng, hợp âm, nốt lấy, rải, tremolo, hoá biểu, nhịp, tempo, repeat/volta. Kéo thả và sao chép như Office, phóng to thu nhỏ tự co giãn, tự giãn ô khi nốt chen chúc. Mở PDF bản nhạc để sửa; lưu MusicXML, MIDI, PDF.
- **Âm thanh**: đàn piano mô hình hoá (cộng hưởng dây, thùng đàn, reverb) và metronome theo nhịp của bài.
- **Xuất video**: mp4 (H.264 + AAC) 720p/1080p, dựng từng khung nên mượt ở mọi máy; không có tiếng metronome.
- **iPad**: cảm ứng đầy đủ (chạm, kéo, véo để zoom, nút ↑ ↓ xoá).

## Cài đặt

Tải bộ cài ở trang [Releases](https://github.com/fonghtdev/NoteFall/releases): `.dmg` cho Mac (Intel và Apple Silicon), `Setup.exe` cho Windows.

Bản Mac chưa notarize: lần đầu mở bằng chuột phải > Mở.

## Chạy từ mã nguồn

Trong thư mục `app/` (Node 20+):

```
npm install
npm start          # build và mở Electron
npm test           # vitest
npm run dist       # bộ cài Mac + Windows vào release/
```

Kiểm thử trên app thật (Electron điều khiển bằng biến môi trường):

```
NOTEFALL_SELFTEST=1 NOTEFALL_COMPOSE=1 npx electron .       # trình soạn nhạc (các chế độ: falling, pdf, showcase, palette, voices)
NOTEFALL_SELFTEST=1 NOTEFALL_FILE=bai.pdf NOTEFALL_EDIT=1 npx electron .   # mở một file trong trình soạn
```

## iPad

Dự án Capacitor nằm ở `app/ios` (chỉ iPad, iOS 16 trở lên).

```
cd app && npx vite build && npx cap sync ios
open ios/App/App.xcodeproj
```

Trong Xcode: chọn target *App*, Signing & Capabilities, đăng nhập Apple ID (tài khoản miễn phí đủ để chạy trên iPad của chính bạn), chọn thiết bị rồi Run. TestFlight và App Store cần tài khoản Apple Developer trả phí.

## Cấu trúc

```
app/
  main.js, preload.cjs     Electron (giao thức app://, menu macOS)
  src/core/                synth, metronome, phách, đọc PDF bản nhạc (omr, smufl, playback, realize)
  src/editor/              trình soạn: model, render (VexFlow), composer, io (MusicXML/PDF/MIDI)
  src/ui/                  màn hình nốt rơi, shader kính, token CSS, lưu/chia sẻ file
  ios/                     dự án iOS (Capacitor)
projectspec.md             spec ban đầu (bản Python, đã thay bằng bản Electron)
CLAUDE.md                  ghi chú cho Claude Code: lệnh, quy ước, quyết định
```

`requirements.txt`, `pytest.ini` và `tests/` là phần Python cũ, không còn dùng cho bản hiện tại.

## Giới hạn đã biết

- Tiếng đàn không thể giống hệt một cây đàn thật nếu không có bản thu mẫu.
- Đọc PDF bản nhạc là nhận dạng, có thể sai ở bản nhạc quá phức tạp hoặc bản scan mờ; ô nào không cộng đủ phách sẽ được cảnh báo.
- Chưa thử trên máy thật: bộ cài Windows và Mac Intel; trên iPad thật thì chưa kiểm tra âm thanh, xuất video, chia sẻ file và hiệu năng.
