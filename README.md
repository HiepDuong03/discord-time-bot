# 🎮 BOT DISCORD CHẤM CÔNG & TỔNG HỢP GIỜ TÍNH LƯƠNG TEAM GAME

Hệ thống Bot Discord tự động hóa chấm công 1 chạm, cảnh báo chống thiếu chỉ tiêu 8h/ngày và xuất báo cáo Excel tính lương theo khoảng ngày tùy chọn.

---

## 🚀 HƯỚNG DẪN CẤU HÌNH & CHẠY BOT TRONG 3 BƯỚC

### BƯỚC 1: Lấy Token Bot trên Discord Developer Portal
1. Truy cập: [Discord Developer Portal](https://discord.com/developers/applications)
2. Bấm **New Application** $\rightarrow$ Đặt tên cho bot (ví dụ: `Aura Time Tracker`).
3. Vào tab **Bot** (bên trái):
   - Bấm **Reset Token** $\rightarrow$ **Copy Token** này lại (Đây là `DISCORD_TOKEN`).
   - Kéo xuống mục **Privileged Gateway Intents**: Bật ON cả 3 mục:
     - ✅ **Presence Intent**
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
4. Vào tab **OAuth2** $\rightarrow$ **URL Generator**:
   - Tích chọn scopes: `bot`, `applications.commands`.
   - Tích chọn bot permissions: `Administrator` (hoặc `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, `Attach Files`).
   - Copy đường link bên dưới và dán vào trình duyệt để **mời Bot vào Server Discord của bạn**.
5. Lấy **Application ID** ở tab *General Information* (Đây là `CLIENT_ID`).
6. Bật chế độ Developer Mode trên Discord để chuột phải vào Server chọn **Copy Server ID** (Đây là `GUILD_ID`).

---

### BƯỚC 2: Điền thông tin vào file `.env`
Tạo một file tên là `.env` ngay tại thư mục `d:\2027\Bot\` (sao chép từ `.env.example`):

```ini
DISCORD_TOKEN=dien_token_cua_ban_o_day
CLIENT_ID=dien_client_id_o_day
GUILD_ID=dien_server_id_o_day

# Tùy chọn:
ON_SHIFT_ROLE_ID=id_role_on_shift_neu_muon_doi_mau_ten
ALERT_CHANNEL_ID=id_kenh_bot_se_ping_nhac_nho_18h_va_22h

DAILY_TARGET_HOURS=8.0
CUTOFF_HOUR=6
TIMEZONE=Asia/Ho_Chi_Minh
```

---

### BƯỚC 3: Khởi chạy Bot
Mở PowerShell tại thư mục `d:\2027\Bot\` và gõ:

```powershell
npm start
```

Khi màn hình hiện:
```
✅ Bot đã đăng nhập thành công với tên: Aura Time Tracker#0000
🚀 BOT ĐÃ SẴN SÀNG HOẠT ĐỘNG 24/7!
```
Nghĩa là Bot đã online và sẵn sàng hoạt động!

---

## 📖 HƯỚNG DẪN SỬ DỤNG CHO BẠN & ANH EM TRONG TEAM

### 1. Tạo Bảng Chấm Công cố định (Chỉ làm 1 lần đầu)
* Vào kênh chuyên chấm công (ví dụ: `#cham-cong`), gõ:
  ```
  /setup-panel
  ```
* Bot sẽ gửi 1 tin nhắn Embed xịn sò kèm 3 nút bấm:
  - 🟢 **Vào Ca:** Bấm khi bắt đầu cày game (đổi màu tên trên Discord).
  - 🔴 **Hết Ca:** Bấm khi nghỉ, bot báo ngay số giờ đã làm trong ngày.
  - ⏱️ **Tiến Độ Hôm Nay:** Xem thanh đo % tiến độ và số giờ còn thiếu.

### 2. Xuất File Excel Tính Lương Theo Kỳ Tùy Ý
* Muốn xuất công cho 2 tuần đầu tháng:
  ```
  /export from:2026-10-01 to:2026-10-15
  ```
* Muốn xuất công trọn vẹn cả tháng:
  ```
  /export from:2026-10-01 to:2026-10-31
  ```
* Bot trả về file `.xlsx` gồm:
  - **Sheet 1:** Bảng tổng hợp số giờ từng người để bạn áp công thức tính lương.
  - **Sheet 2:** Chi tiết lịch sử từng ca (vào lúc nào, ra lúc nào, làm bao nhiêu phút).

### 3. Xem Biểu Đồ Trực Quan (Data Visualization)
* Gõ lệnh:
  ```
  /report
  ```
* Bot trả về ảnh biểu đồ cột so sánh tiến độ thực tế với vạch kẻ ngang đỏ 8h của cả team.

### 4. Bù giờ / Trừ giờ khi có sự cố
* Nếu nhân viên mất điện hoặc quên bấm:
  ```
  /adjust-time user:@NguyenVanA minutes:60 reason:Mất điện ca sáng
  ```
  *(Có lưu lịch sử Audit Log minh bạch).*

---

## ⚙️ CÁC QUY TẮC TỰ ĐỘNG CHẠY NGẦM
* **Chốt ngày lúc 06:00 sáng:** Ca làm từ 22:00 đêm đến 04:00 sáng vẫn tính trọn vào ngày hôm trước.
* **Tự động nhắc nhở 18:00:** Ping nhắc những ai mới cày dưới 4 tiếng tránh chủ quan.
* **Cảnh báo khẩn cấp 22:00:** Ping nhắc gấp những ai có nguy cơ không kịp đạt 8 tiếng trước 06:00 sáng mai.
