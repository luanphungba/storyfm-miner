# storyfm-miner

Nghe podcast [故事FM](https://storyfm.cn) kèm transcript chạy theo tiếng, rồi bôi đen từ để tạo thẻ Anki
bằng extension [youtube-chinese-miner](../youtube-chinese-miner).

故事FM không công bố 文字稿 ở bất cứ đâu — RSS, trang chủ và 小宇宙 đều chỉ có shownotes, và podcaster
đã tắt tính năng 文稿 của 小宇宙. Repo này tự sinh transcript, lưu lên git, rồi phục vụ qua GitHub Pages.

**Audio không được lưu ở đây.** Chỉ transcript (~80KB/tập, text). Trang phát thẳng từ CDN gốc lấy
trong RSS, nên không tốn dung lượng và không phát tán lại file có bản quyền.

## Cài đặt

```bash
cp .env.example .env     # rồi điền ASSEMBLYAI_API_KEY
node bin/storyfm.js sync
```

## Dùng

```bash
storyfm sync                  # tải lại RSS về data/feed.xml
storyfm list --limit 20       # liệt kê tập (✓ = đã có transcript)
storyfm add E910              # transcribe một tập  (~$0.13)
storyfm add E910 --force      # chạy lại tập đã có
storyfm add E910 --narrator B # chỉ định speaker nào là người dẫn

npm test                      # unit test
npm run serve                 # http://localhost:8080
```

`add` không tự commit. Xem kết quả xong thì tự `git add docs/data data/raw && git commit`.

## Cách hoạt động

```
RSS (data/feed.xml)
  └─ enclosure mp3 ──► AssemblyAI (audio_url: server họ tự tải, máy mình không upload gì)
                          └─ words[] ──► segment.js ──► roles.js ──► docs/data/E910.json
                                                                        │
                            docs/player.html ◄───────────────────────────┘
                                 └─ postMessage cues ──► extension CI Chinese ──► thẻ Anki
```

| File | Vai trò |
|---|---|
| `src/feed.js` | Tải + parse RSS. Nguồn sự thật cho id, tiêu đề, URL audio |
| `src/asr.js` | AssemblyAI: gửi `audio_url`, poll tới khi xong |
| `src/segment.js` | Cắt word list thành câu. Hàm thuần, có test |
| `src/roles.js` | Đoán speaker nào là người dẫn 爱哲. Hàm thuần, có test |
| `src/build.js` | Ráp episode JSON, cập nhật index. Ghi một lần qua file tạm |
| `docs/` | GitHub Pages root. Vanilla HTML/CSS/JS, không build step |

## Ghi chú

- **Không dùng LLM để chấm lại câu.** AssemblyAI đã trả về có dấu câu; để model viết lại text sẽ làm
  trôi timestamp, mà timestamp là thứ cả highlight, nút lặp và thẻ Anki đều dựa vào. `add` in ra tỉ lệ
  câu kết thúc bằng 。！？ — dưới 50% là dấu hiệu ASR chấm câu kém, cần xem lại tập đó.
- **Response thô của AssemblyAI được commit** vào `data/raw/`. Nếu sau muốn karaoke theo từng chữ thì
  đọc lại từ đó, không phải trả tiền transcribe lần hai.
- **Thứ tự DOM của `.cue` phải khớp mảng `cues`.** Extension ánh xạ vùng bôi đen về cue theo vị trí
  DOM, nên bộ lọc "chỉ người kể" ẩn bằng CSS chứ không xoá phần tử.
- **Đừng dùng `static.storyfm.cn`.** Đo thực tế: 198 KB/s và chặn hotlink bằng Referer ACL (403 với
  mọi site khác, kể cả khi không gửi Referer). CDN trong RSS nhanh gấp 7 lần và cho CORS.
- `docs/data/DEMO.json` là fixture giả để thử giao diện, đã bị gitignore.
