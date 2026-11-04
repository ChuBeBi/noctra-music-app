# NOCTRA — web app nghe nhạc YouTube

## Yêu cầu
- Node.js LTS (khuyến nghị Node 20 hoặc 22)
- npm
- Kết nối Internet

## Chạy trên Windows
Mở terminal tại thư mục `noctra-music-app`:

```powershell
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

Mở `http://localhost:5173`. API chạy tại `http://localhost:5000/api/songs`.

## Cấu trúc
- `client/`: React + Vite, giao diện responsive/PWA.
- `server/`: Node.js + Express API, danh sách bài mẫu.
- `client/public/manifest.webmanifest`: thông tin web app để thêm vào Home Screen.

## Dùng trên iPhone
Để truy cập từ iPhone, triển khai frontend lên HTTPS hosting và backend lên một dịch vụ Node hosting; đặt biến `VITE_API_URL` ở frontend bằng URL backend có `/api` ở cuối, ví dụ `https://api-cua-ban.example.com/api`. Đây chỉ là định dạng ví dụ, hãy thay bằng URL thật do hosting cấp.

Sau khi có website HTTPS, mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính.

## YouTube
Ứng dụng dùng YouTube IFrame Player API chính thức. Dán URL YouTube hoặc ID video vào ô thêm bài. Chỉ phát được video cho phép nhúng. Không tách luồng âm thanh khỏi YouTube.
Phát khi khóa màn hình/chuyển app phụ thuộc iOS, Safari và chính sách của YouTube; không thể bảo đảm trong mọi trường hợp.
