# Notefall — Project Spec

> App desktop (Python + PySide6): import một bài nhạc, hệ thống tự phân tích và hiển thị **nốt nhạc kiểu pha lê rơi xuống đúng phím piano**, phím có hiệu ứng "đánh phím". Không hiển thị tay.

Phương pháp: **3C — Cover (đủ phạm vi) · Clean (kiến trúc sạch) · Clear (rõ giới hạn)**.

---

## 1. Mục tiêu

Mở app là thấy sẵn **đàn piano 88 phím** ở dưới. Import bài nhạc xong, hệ thống phân tích và các nốt rơi xuống đúng phím. Khi nốt chạm vạch, phím tương ứng **lún xuống và sáng lên**.

```
Import (mp3 / wav / mid)
  ├─► Beat detector (ĐÃ CÓ) ──► lưới beat
  └─► Transcriber ──► Note[] (pitch, start, duration, velocity)
                          │
                 PianoView (vẽ theo currentTime)
```

### Ngoài phạm vi (giai đoạn đầu)
- Hiển thị tay người chơi.
- Chỉnh sửa nốt bằng tay (có thể làm sau).
- Xuất video (có thể làm sau, M5).

---

## 2. Hiện trạng

| Hạng mục | Trạng thái |
|---|---|
| Dò beat, tempo, đầu ô nhịp (librosa) | Xong, 5/5 test pass với click track 90/120/140 BPM |
| Giao diện: waveform + vạch beat + thanh beat rơi + phát nhạc + tua | Xong, kiểm tra ở chế độ offscreen |
| Đồng hồ phát nội suy mượt (`PlaybackClock`) | Xong |
| Phân tích ở thread nền + thanh tiến trình | Xong |
| Piano 88 phím, nốt rơi theo pitch, hiệu ứng phím | **Chưa làm** (spec này) |
| Audio → nốt nhạc | **Chưa làm** |

Chưa kiểm chứng được trong sandbox: phát âm thanh thật và độ khớp tiếng với hình (cần chạy trên máy người dùng).

---

## 3. Kiến trúc (Clean)

Quy tắc phụ thuộc: `ui → core`, không đi ngược lại.

```
notefall/
  core/
    models.py            BeatGrid, Note, Project
    beat_detector.py     (có sẵn)
    transcribers/
      base.py            Transcriber: audio_path -> list[Note]
      midi_file.py       đọc .mid (chính xác tuyệt đối)
      basic_pitch.py     audio -> notes (đa âm, ONNX, không cần TensorFlow)
    postprocess.py       lọc nốt yếu/ngắn, giới hạn 21–108, quantize theo beat
    cache.py             lưu kết quả cạnh file nhạc để mở lại không phải phân tích lại
  ui/
    piano_geometry.py    pitch -> x, độ rộng phím trắng/đen (thuần tính toán)
    key_state.py         tại thời điểm t: phím nào đang bấm, press ∈ [0,1] (thuần logic)
    particles.py         hạt vàng
    piano_view.py        chỉ vẽ, không biết gì về audio
    clock.py, worker.py, waveform_view.py, main_window.py   (có sẵn)
  cli.py
tests/
```

Nguyên tắc:
- `geometry` và `key_state` tách khỏi phần vẽ để unit test không cần màn hình.
- `PianoView` chỉ nhận `t` và `Note[]`, nên đổi renderer (QPainter → GPU) không ảnh hưởng phần còn lại.
- Đổi engine transcribe hoặc beat chỉ sửa trong `core/`.

### Mô hình dữ liệu

```python
Note(pitch: int,      # MIDI 21..108
     start: float,    # giây
     duration: float, # giây
     velocity: int)   # 1..127
```

---

## 4. PianoView (Cover)

### Bố cục
Vùng nốt rơi phía trên · vạch chạm phát sáng · bàn phím 88 phím phía dưới. Nền tối, có thể thêm trăng/sao.

### Nốt rơi
- `x` lấy từ pitch: 52 phím trắng, phím đen lệch chuẩn; nốt đen hẹp hơn nốt trắng.
- `y = hit_y − (start − t) × px_per_sec`; chiều cao = `duration × px_per_sec`, có mức tối thiểu để vẫn ra hình viên đá.
- Kiểu pha lê: bo góc, gradient dọc, viền sáng; sprite cache sẵn.
- Màu theo tay trái/phải (ngưỡng pitch) hoặc theo velocity; xanh khi còn xa, chuyển vàng khi chạm.

### Hiệu ứng "đánh phím"
Mỗi phím có `press ∈ [0,1]`: lên nhanh (~40 ms) khi nốt chạm, trả về chậm (~120 ms) khi nốt hết.

| Thành phần | Hành vi |
|---|---|
| Phím trắng | Lún xuống vài pixel, sáng theo velocity |
| Phím đen | Lún kèm bóng đổ |
| Cột sáng | Bốc lên từ phím, độ sáng theo velocity |
| Vạch chạm | Nhấp nháy tại đúng cột phím vừa bấm |
| Hạt vàng | Bắn ra từ điểm chạm, số lượng theo velocity; pool giới hạn; xóa sạch khi tua |

### Hiệu năng
- Bắt đầu bằng QPainter + cache sprite, 60 fps.
- Nếu muốn liquid glass thật (blur, khúc xạ): chuyển renderer sang GPU (QOpenGLWidget hoặc Qt Quick shader).

### Cài đặt người dùng
Tốc độ rơi / độ dài nhìn trước (lookahead), bật/tắt vạch beat, bật/tắt hạt, theme màu.

---

## 5. Transcriber

| Nguồn | Độ chính xác | Ghi chú |
|---|---|---|
| File `.mid` | Tuyệt đối | Làm đầu tiên để kiểm chứng giao diện |
| Basic Pitch | Tốt với piano solo, kém dần khi có hát và nhiều nhạc cụ | Offline, CPU. Cài được trong sandbox nhưng **chưa chạy thử** |
| Demucs (tách piano khỏi bài hát) | Cải thiện bài nhiều nhạc cụ | Nặng, để giai đoạn sau |

### Hậu xử lý (bắt buộc)
- Bỏ nốt quá ngắn hoặc quá yếu.
- Gộp nốt trùng.
- Giới hạn pitch 21–108.
- Giới hạn số nốt đồng thời để dễ nhìn.
- Tùy chọn: quantize nốt vào lưới beat đã dò.

### Cache
Lưu `Note[]` và `BeatGrid` cạnh file nhạc (khóa theo hash) để mở lại tức thì.

---

## 6. Lộ trình

| Mốc | Nội dung | Kết quả kiểm chứng |
|---|---|---|
| **M1** | `PianoView` + import `.mid` (không cần AI) | Xem được nốt rơi và phím bấm; đồng bộ với âm thanh |
| **M2** | Transcriber Basic Pitch ở thread nền, thanh tiến trình, cache | Audio piano tổng hợp ra đúng nốt |
| **M3** | Vạch beat mờ ngang, quantize theo beat, chỉnh tay (tempo ×2/÷2, dịch offset) | Nốt khớp lưới nhịp |
| **M4** | Hạt, glow, theme, cài đặt tốc độ/lookahead | Hình ảnh gần ảnh tham chiếu |
| **M5** | Đóng gói (PyInstaller); về sau xuất video bằng ffmpeg | File chạy độc lập |

### Cách kiểm chứng
- Test tự động với audio tổng hợp có nốt đã biết: pitch đúng, onset lệch dưới ~50 ms.
- Unit test cho `piano_geometry` (pitch → x) và `key_state` (nốt → trạng thái phím).
- Chụp ảnh giao diện offscreen ở nhiều thời điểm để soát hiệu ứng.
- Chạy thật trên máy người dùng để nghe độ khớp âm thanh.

---

## 7. Rủi ro và giới hạn (Clear)

- Bài có hát hoặc nhiều nhạc cụ cho nốt nhiễu và sai; chưa có AI nào hoàn hảo. Cần chế độ lọc, sau này chỉnh tay.
- Nhạc càng nhanh và dày nốt thì độ chính xác càng giảm.
- Beat tracker hay nhầm gấp đôi/một nửa tempo; ước lượng ô nhịp (3/4, 4/4) còn đơn giản, nhạc đổi nhịp sẽ sai.
- Đọc mp3 phụ thuộc ffmpeg/backend trên máy; wav/flac luôn chạy.
- Chưa kiểm được âm thanh thật trong sandbox (không có thiết bị audio).

---

## 8. Câu hỏi cần quyết định

1. **Nhạc đầu vào chính** là piano solo hay bài hát đầy đủ? (Quyết định có cần Demucs sớm không.)
2. **Hệ điều hành** (Windows/macOS)? Ảnh hưởng đóng gói và codec mp3.
3. **Thứ tự bắt đầu**: M1 (MIDI trước) như đề xuất, hay thử ngay audio → nốt?

Đề xuất: làm **M1 + M2 liền nhau**.
