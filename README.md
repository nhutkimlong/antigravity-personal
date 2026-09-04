# Antigravity Personal Extension 🚀

> **Extension cá nhân tích hợp 2-trong-1**: Tự động hóa tương tác (Auto Accept & Auto Scroll) và Quản lý/chuyển đổi đa tài khoản Google Antigravity Model Cockpit.

Được kết hợp hoàn hảo từ hai dự án mã nguồn mở mạnh mẽ:
- **`antigravity-cockpit`** (Quản lý đa tài khoản Google Antigravity, theo dõi quota Claude & Gemini, chuyển đổi token)
- **`ag-auto-click-scroll`** (Tự động chấp thuận bước agent: Accept, Allow, Run, Keep Waiting, và tự động cuộn tin nhắn chat)

---

## 🌟 Tính Năng Nổi Bật

### 1. 🤖 Tự Động Chấp Thuận (Auto Accept) & Cuộn Khung Chat (Auto Scroll)
- **Auto Click Thông Minh**: Tự động quét và nhấn các nút xác nhận như:
  - `Accept`, `Accept all`, `Run`, `Allow`, `Always Allow`, `Keep Waiting`, `Retry`, `Continue`
  - Tự động chạy lệnh background chat-safe (`antigravity.agent.acceptAgentStep`, `antigravity.terminalCommand.accept`, v.v.)
- **Auto Scroll Khung Chat**: Tự động cuộn xuống dưới cùng khi bot đang trả lời hoặc sinh code mới. Tạm dừng thông minh khi bạn cuộn tay để đọc.
- **Tự Động Nhấn "Keep Waiting" trên Windows**: Tích hợp P/Invoke Win32 để tự động bấm dialog pop-up hệ thống "Keep Waiting" của Antigravity khi xử lý tác vụ nặng.
- **Giao Diện Cài Đặt Riêng (Settings Panel)**:
  - Cho phép bật/tắt từng pattern nút click.
  - Tùy chỉnh tốc độ quét click và cuộn (ms).
  - Thống kê số lần tự động click theo thời gian thực (Click Stats & Click Log).
  - Bật/tắt tức thời bằng nút trên thanh trạng thái (Status Bar) góc dưới bên phải.

---

### 2. 🛸 Quản Lý Đa Tài Khoản & Theo Dõi Model Quota
- **Bảng Điều Khiển Đa Tài Khoản (Cockpit Dashboard)**:
  - Giao diện trực quan theo dõi chi tiết hạn mức quota theo từng model (Gemini 3 Pro, Gemini Flash, Claude 3.7 Sonnet...).
  - Thời gian reset quota cụ thể cho từng model.
- **Chuyển Đổi Tài Khoản Mượt Mà**:
  - Tự động ghi đè token vào SQLite database của Antigravity IDE (`state.vscdb`).
  - Hỗ trợ chế độ an toàn (Safe mode) hoặc chế độ nhanh nâng cao (Advanced mode).
- **Tự Động Đồng Bộ Với IDE**:
  - Lắng nghe file database của Antigravity IDE theo thời gian thực.
  - Khi bạn đăng nhập tài khoản Google mới trong IDE, extension sẽ tự động nhận diện và lưu vào danh sách.
- **Quản Lý Token & Đồng Bộ Đa Thiết Bị**:
  - Đăng nhập trực tiếp bằng Google OAuth hoặc bằng Refresh Token.
  - Xuất (Export) và Nhập (Import) hàng loạt token tài khoản dạng JSON để sao lưu hoặc chuyển đổi sang máy tính khác.
- **Hiển Thị Thanh Trạng Thái (Status Bar)**:
  - Hiển thị phần trăm quota của các model ngay trên thanh trạng thái dưới cùng: `🟢 Claude: 100% | 🟢 Gemini: 95%`.
  - Di chuột vào để xem bảng biểu đồ trực quan Markdown.

---

## 📦 Cách Cài Đặt & Sử Dụng

### Cách 1: Cài đặt trực tiếp file `.vsix` đã đóng gói (Khuyên dùng)
File cài đặt đã được build sẵn tại:
```
D:\CODE\Extension\antigravity-personal\antigravity-personal-1.0.0.vsix
```

1. Mở VS Code / Antigravity IDE.
2. Bấm tổ hợp phím `Ctrl + Shift + P` (hoặc `F1`), gõ:
   ```
   Extensions: Install from VSIX...
   ```
3. Chọn file `antigravity-personal-1.0.0.vsix`.
4. Sau khi cài đặt xong, chọn **Reload Window** khi có thông báo.

---

### Cách 2: Chạy trực tiếp từ thư mục mã nguồn (Developer Mode)
Nếu muốn chỉnh sửa thêm tính năng:
1. Mở thư mục `D:\CODE\Extension\antigravity-personal` trong VS Code.
2. Bấm `F5` để khởi chạy Extension Development Host mới.
3. Trong cửa sổ mới mở ra, extension sẽ tự động kích hoạt.

---

## 🛠️ Các Lệnh Thao Tác (Command Palette)

Bấm `Ctrl + Shift + P` và gõ tên lệnh:

### Nhóm lệnh Quản lý Tài Khoản & Model
| Lệnh | Mô tả |
| :--- | :--- |
| `Antigravity: Open Dashboard` | Mở bảng điều khiển quản lý tài khoản & xem quota model |
| `Antigravity: Switch Account` | Chuyển sang tài khoản Google khác |
| `Antigravity: Add Account` | Thêm tài khoản Google qua OAuth |
| `Antigravity: Login with Refresh Token` | Đăng nhập bằng mã Refresh Token |
| `Antigravity: Batch Export All Tokens` | Xuất toàn bộ token ra file JSON |
| `Antigravity: Batch Import Tokens` | Nhập danh sách token từ file JSON |

### Nhóm lệnh Tự Động Accept & Scroll
| Lệnh | Mô tả |
| :--- | :--- |
| `AG Auto: Open Settings` | Mở giao diện cài đặt Auto Click, Auto Scroll & Click Log |
| `AG Auto: Enable (Inject Script)` | Kích hoạt và chèn script tự động vào giao diện Antigravity |
| `AG Auto: Disable (Remove Script)` | Gỡ bỏ script tự động khỏi giao diện |

---

## ⚙️ Cấu Hình (Settings)

Extension cung cấp đầy đủ các cấu hình trong `Settings (Ctrl + ,)`:
- `ag-auto.enabled`: Bật/tắt toàn bộ tính năng tự động click & scroll.
- `ag-auto.scrollEnabled`: Bật/tắt riêng chế độ tự động cuộn chat.
- `ag-auto.clickPatterns`: Danh sách các từ khóa nút tự động bấm (`Accept`, `Allow`, `Run`,...).
- `ag-auto.scrollPauseMs`: Thời gian nghỉ khi phát hiện người dùng tự cuộn chuột (mặc định 7000ms).
- `antigravity-cockpit.autoRefreshInterval`: Khoảng thời gian tự động quét và làm mới hạn mức quota (phút).
- `antigravity-cockpit.switchMode`: Phương thức chuyển đổi tài khoản (`advanced` hoặc `safe`).
