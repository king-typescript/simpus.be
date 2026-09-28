PRODUCT REQUIREMENT 
DOCUMENT (PRD) 
SISTEM INFORMASI & MANAJEMEN 
PERPUSTAKAAN SEKOLAH (SIMPUS) 
1. Ringkasan Eksekutif (Executive Summary) 
Sistem Informasi & Manajemen Perpustakaan Sekolah (SIMPUS) adalah platform berbasis web yang dirancang untuk mengotomatisasi operasional perpustakaan sekolah. Sistem ini menjembatani interaksi antara Siswa (sebagai peminjam) dan Pustakawan (sebagai pengelola/admin) dalam proses pencarian buku, peminjaman, pengembalian, penghitungan denda, serta pencatatan stok buku secara akurat dan transparan. Dengan digitalisasi ini, sekolah diharapkan dapat beralih dari manajemen fisik konvensional menuju tata kelola data yang modern dan terintegrasi. 
2. Sasaran & Tujuan (Goals & Objectives) 
● Pencatatan Terpusat: Menghilangkan pencatatan sirkulasi manual berbasis buku besar kertas guna meminimalkan risiko kehilangan data inventaris dan riwayat pinjaman siswa. 
● Efisiensi Transaksi Sirkulasi: Mempercepat transaksi pinjam dan kembali menjadi di bawah 30 detik per buku menggunakan pemindaian barcode/QR code. 
● Aksesibilitas Mandiri: Memberikan akses kepada siswa untuk memeriksa ketersediaan buku dan riwayat pinjaman langsung dari perangkat masing-masing (smartphone/komputer lab). 
● Transparansi Finansial: Memastikan setiap denda keterlambatan tercatat secara otomatis dan dapat dipertanggungjawabkan oleh unit perpustakaan.
3. Persona Pengguna & Hak Akses (User Roles & Permissions) 
Peran Deskripsi Hak Akses 
Mengelola katalog buku (CRUD), 
memproses transaksi sirkulasi 
Pustakawan Siswa 
(pinjam/kembali), memvalidasi pembayaran denda, mengelola basis data siswa, dan menarik laporan berkala. 
Mengakses OPAC (Online Public Access Catalog), melihat status buku, memantau riwayat peminjaman pribadi, melihat tagihan denda, dan 
mengajukan perpanjangan durasi pinjam. 
4. Persyaratan Fungsional (Functional Requirements) 
Fitur Utama 
	Manajemen Anggota 
Katalogisasi & Stok
	



ID Deskripsi Spesifikasi 
Mendukung import data 
siswa massal via 
Excel/CSV. Sistem mampu 
FR-01 FR-02 
menjabarkan NIS, Nama, dan Kelas, serta 
menghasilkan kartu perpustakaan digital unik. 
Input metadata buku lengkap (ISBN, Penulis, Rak, Kategori DDC). Memantau status 
eksemplar secara 
real-time (Tersedia,


Fitur Utama 
	

	Modul Sirkulasi
	Katalog Publik (OPAC)
	Laporan & Rekap
	



ID Deskripsi Spesifikasi 
Dipinjam, Rusak, atau 
Hilang). 
Integrasi pemindai 
barcode untuk transaksi. 
Aturan otomatis: maksimal 
FR-03 
FR-04 FR-05 
3 buku, durasi 7 hari, denda Rp1.000/hari, dan perpanjangan mandiri 1 kali. 
Antarmuka pencarian untuk siswa dengan fitur filter cerdas berdasarkan kategori dan ketersediaan buku di rak fisik. 
Dasbor statistik untuk pustakawan yang 
mencakup rekap denda tunai, buku paling populer, dan ekspor laporan ke format XLSX atau PDF. 
5. Persyaratan Non-Fungsional (Non-Functional Requirements) 
● NFR-01: Kinerja - Waktu pemuatan pencarian katalog buku tidak boleh lebih dari 1,5 detik pada kondisi jaringan standar. 
● NFR-02: Aksesibilitas - Desain antarmuka harus menggunakan prinsip Responsive Web Design agar optimal dibuka melalui smartphone siswa maupun desktop perpustakaan. 
● NFR-03: Keamanan - Enkripsi kata sandi menggunakan standar Bcrypt atau Argon2. Penerapan Role-Based Access Control (RBAC) untuk memisahkan fungsi admin dan siswa.
● NFR-04: Keandalan - Sistem wajib melakukan pencadangan database otomatis (daily backup) pada pukul 00:00 setiap hari untuk mencegah kehilangan data. 
6. Batasan Sistem (Out of Scope) 
● Sistem tidak mendukung integrasi payment gateway (misal: Midtrans/Xendit). Seluruh pembayaran denda dilakukan tunai melalui pustakawan. 
● Sistem tidak menyediakan fitur pembaca e-book di dalam aplikasi (fokus hanya pada manajemen inventaris buku fisik). 
● Integrasi gerbang fisik otomatis (RFID Turnstile) tidak termasuk dalam pengembangan fase ini. 
7. Metrik Keberhasilan (Success Metrics) 
● Kecepatan Layanan: Pengurangan durasi antrean peminjaman hingga di bawah 30 detik per siswa per sesi. 
● Adopsi Pengguna: Minimal 85% siswa terdaftar melakukan login dan menggunakan fitur OPAC dalam satu semester pertama implementasi. ● Akurasi Data: Tingkat selisih antara jumlah stok buku fisik di rak dengan data di sistem (stock opname) harus di bawah 2%. 
Dokumen ini disetujui oleh: 
