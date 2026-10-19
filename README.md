# Batı Toroslar Jeoloji Atlası

MTA 1:100.000 ölçekli jeoloji paftalarından üretilmiş etkileşimli web haritası.

- **Vektör jeoloji katmanı**: Afyon-K24, K25, K26, L24, L25, L26, Isparta-J10 (M24), Isparta-J11 (M25) — paftalardaki etiketlerden ve renklerden sayısallaştırıldı.
- **Taranmış paftalar**: 31 pafta görüntüsü, köşe koordinatlarından (ED50 → WGS84) yerine oturtuldu; tek tek açılıp şeffaflığı ayarlanabilir.
- **Birim bilgisi**: tıklanan noktadaki formasyon, yaş, litoloji, tektonik birim, kot; paftanın stratigrafik dizilimi ve poligonun komşu üst/alt birimleri.
- **Topoğrafik-jeolojik kesit**: iki nokta arasında arazi profili (AWS Terrain Tiles), yüzeydeki birimler; SVG ve CSV indirme.
- **3B arazi**, kabartma gölgesi, uydu / topoğrafya / OSM altlıkları, MTA diri fay hatları, birim arama, ölçüm.

## Notlar
- Sayısallaştırma otomatik renk/desen sınıflaması + elle okunan etiketlerle yapılmıştır; birim sınırları kaynak tarama çözünürlüğüyle sınırlıdır (~40–80 m).
- Kesitlerde yüzey altı geometrisi yorumlanmamıştır; renkli şerit yalnızca yüzeydeki birimi gösterir.
- Kaynak: MTA Genel Müdürlüğü 1:100.000 ölçekli Türkiye Jeoloji Haritaları; MTA Diri Fay Haritası.

## Yerel çalıştırma
```
python -m http.server 8000
```
ardından http://localhost:8000
