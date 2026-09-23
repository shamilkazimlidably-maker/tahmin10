import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS } from "@/src/config/business";

export const metadata: Metadata = { title: "Gizlilik — TAHMİN10" };

export default function Privacy() {
  return (
    <main className="doc">
      <p className="eyebrow">{BUSINESS.brand}</p>
      <h1>Gizlilik</h1>
      <p>6698 sayılı KVKK kapsamında hangi verileri, ne için kullandığımızın açık anlatımı.</p>

      <h2>Neleri topluyoruz?</h2>
      <ul>
        <li>Bu sayfada: bir çerezde rastgele bir kimlik, seni getiren reklamın parametreleri (UTM, fbclid), IP adresi ve tarayıcı bilgisi.</li>
        <li>Telegram'da: herkese açık Telegram kimliğin, adın ve @kullanıcı adın, botumuzla yazıştığın mesajlar ve kanallarımıza katılıp katılmadığın.</li>
        <li>Ödemede: ödemeyi Whop işler. Bize yalnızca onay, plan, tutar ve ödemede kullanılan e-posta ulaşır. Kart bilgilerine erişimimiz yoktur.</li>
      </ul>

      <h2>Ne için kullanıyoruz?</h2>
      <ul>
        <li>Telegram'da sana yardımcı olmak, kanal erişimini vermek ve destek sağlamak.</li>
        <li>Reklamlarımızın sonucunu ölçmek ve bizimle etkileşime girenlere reklam göstermek (ya da göstermemek): Meta Pixel, Conversions API ve Meta özel hedef kitleleri. Ödeme e-postası gibi tanımlayıcılar şifrelenmiş (hash) olarak gönderilir. Dahil edilmek istemiyorsan sohbete DUR yaz ya da bottan talep et.</li>
        <li>Hizmeti iyileştirmek: sık sorulan soruları anlamak için konuşmalar, yapay zekâ sistemleri dahil, analiz edilir.</li>
      </ul>

      <h2>Verileri bizim adımıza kimler işliyor?</h2>
      <p>Vercel ve Supabase (barındırma ve veritabanı), Telegram (mesajlaşma), DeepSeek (sanal asistan), Whop (ödeme) ve Meta (reklam ölçümü). Verilerini satmıyoruz.</p>

      <h2>Sanal asistan</h2>
      <p>Telegram'daki görüşme bir sanal asistan tarafından yürütülür. İstediğin an ekipten bir insanla konuşmayı isteyebilirsin.</p>

      <h2>Hakların</h2>
      <p>
        Verilerine erişme, düzeltme ya da silinmesini isteme hakkın var; Telegram'daki botumuza yazman yeterli. Mesaj almayı bırakmak için sohbete <strong>DUR</strong> yaz.
      </p>

      <h2>Yaş</h2>
      <p>İçerik yalnızca {BUSINESS.minimumAge} yaş üstü içindir.</p>

      <p>
        <Link href="/">← Geri</Link>
      </p>
    </main>
  );
}
