import { SectionsConfig } from "./types";

/**
 * The general CMB/BIST template - the vast majority of symbols. Banks
 * (BDDK) and insurers (SEDDK) file under their own, unrelated chart of
 * accounts entirely and get their own standalone config (see ./bank,
 * ./insurance) rather than a variant of this one - none of the three
 * vocabularies overlap, so building on this one would only drag in dead
 * sections (e.g. neither bank nor insurance reports have a "dönen
 * varlıklar"/"duran varlıklar" split) with no matching benefit.
 */
export const generalSections: SectionsConfig = {
  currentAssets: {
    sectionStartKeys: ["nakit ve nakit benzerleri"],
    sectionEndKeys: [
      "toplam dönen varlıklar",
      "dönen varlıklar",
      "duran varlıklar",
    ],
    nextSection: "noncurrentAssets",
    allowDetailSum: true,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "nakit ve nakit benzerleri",
        keyword: ["nakit ve nakit benzerleri"],
      },
      {
        chosenLabel: "finansal yatırımlar",
        keyword: ["finansal yatırımlar", "Finansal varlıklar"],
      },
    ],
  },
  noncurrentAssets: {
    sectionStartKeys: [],
    sectionEndKeys: ["toplam varlıklar", "toplam kaynaklar"],
    nextSection: "shortDebts",
    allowDetailSum: true,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "duran finansal yatırımlar",
        keyword: ["finansal yatırımlar", "Finansal varlıklar"],
      },
    ],
  },
  shortDebts: {
    sectionStartKeys: [
      "kısa vadeli borçlanmalar",
      "kısa vadeli yükümlülükler",
      "Kısa vadeli yükümlülükler:",
    ],
    sectionEndKeys: ["TOPLAM KISA VADELİ YÜKÜMLÜLÜKLER"],
    nextSection: "longDebts",
    allowDetailSum: true,
    // this feature only effects ttkom and ttrak.
    keywordPrefixes: ["İlişkili taraflardan", "İlişkili olmayan taraflardan"],
    keywordSchemas: [
      {
        chosenLabel: "kısa vadeli borçlanmalar",
        keyword: ["kısa vadeli borçlanmalar", "Banka kredileri"],
      },
      {
        chosenLabel: "uzun vadeli borçlanmaların kısa vadeli kısımları",
        keyword: [
          "uzun vadeli borçlanmaların kısa vadeli kısımları",
          "Uzun vadeli borçlanmaların kısa vadeli kısmı",
          "uzun vadeli finansal borçların kısa vadeli kısımları",
        ],
      },
      {
        chosenLabel: "kısa dönem kira yükümlülükleri",
        keyword: [
          "Kiralama işlemlerinden kaynaklanan yükümlülükler",
          "Kısa vadeli kiralama işlemlerinden borçlar",
          "Kısa Vadeli Kiralama Borçları",
          "kısa vadeli kiralama yükümlülükleri",
          "Kiralama işlemlerinden borçların kısa vadeli kısımları",
          "kiralama yükümlülükleri",
          "kiralama işlemlerinden kısa vadeli yükümlülükler",
          "kiralama işlemlerinden borçlar",
          "finansal kiralama işlemlerinden borçlar",
        ],
      },
    ],
  },
  longDebts: {
    sectionStartKeys: [
      "Uzun vadeli borçlanmalar",
      "Uzun vadeli yükümlülükler",
      "Uzun vadeli yükümlülükler:",
    ],
    sectionEndKeys: ["TOPLAM UZUN VADELİ YÜKÜMLÜLÜKLER"],
    nextSection: "equity",
    allowDetailSum: true,
    keywordPrefixes: ["İlişkili taraflardan", "İlişkili olmayan taraflardan"],
    keywordSchemas: [
      {
        chosenLabel: "uzun vadeli borçlanmalar",
        keyword: ["uzun vadeli borçlanmalar", "Banka kredileri"],
      },
      {
        chosenLabel: "uzun dönem kira yükümlülükleri",
        keyword: [
          "Kiralama işlemlerinden kaynaklanan yükümlülükler",
          "Uzun vadeli kiralama işlemlerinden borçlar",
          "Uzun Vadeli Kiralama Borçları",
          "uzun vadeli kiralama yükümlülükleri",
          "kiralama yükümlülükleri",
          "kiralama işlemlerinden uzun vadeli yükümlülükler",
          "kiralama işlemlerinden borçlar",
          "finansal kiralama işlemlerinden borçlar",
        ],
      },
    ],
  },

  equity: {
    sectionStartKeys: [
      "özkaynaklar",
      "ana ortaklığa ait özkaynaklar",
      "ana ortaklığa ait özkaynaklar:",
      "Ana ortaklığa ait özkaynaklar toplamı",
      "toplam özkaynaklar",
    ],
    sectionEndKeys: [
      "toplam kaynaklar",
      "toplam yükümlülükler ve özkaynaklar",
      "TOPLAM YÜKÜMLÜLÜKLER VE ÖZKAYNAK",
      "Toplam özkaynaklar ve yükümlülükler",
    ],
    // TODO nextsection doens't work since between equity and revenue section there is always #page-end# (equity page is finished). when equity ended, revenue section starts by force chain but then middle #page-end# ends the revenue.
    // nextSection: "revenue",
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "ana ortaklığa ait özkaynaklar",
        keyword: [
          "ana ortaklığa ait özkaynaklar",
          "ana ortaklığa ait özkaynaklar:",
          "Ana ortaklığa ait özkaynaklar toplamı",
          "özkaynaklar",
          "toplam özkaynaklar",
          "toplam özkaynak",
        ],
      },
      {
        chosenLabel: "toplam kaynaklar",
        keyword: [
          "toplam kaynaklar",
          "toplam yükümlülükler ve özkaynaklar",
          "TOPLAM YÜKÜMLÜLÜKLER VE ÖZKAYNAK",
          "toplam yükümlülük ve özkaynaklar",
          "Toplam özkaynaklar ve yükümlülükler",
          "toplam kaynaklar ve özkaynaklar",
        ],
      },
    ],
  },
  revenue: {
    sectionStartKeys: ["hasılat", "Hasılat (net)", "Satışlar", "gelirler"],
    sectionEndKeys: [
      "DİĞER KAPSAMLI GELİRLER",
      "diğer kapsamlı gelirler",
      "DİĞER KAPSAMLI GİDER/GELİR",
      "diğer kapsamlı gelir/(gider)",
      "diğer kapsamlı gider/gelir",
      "diğer kapsamlı gelirler:",
      "Pay Başına Kazanç (Zarar)",
      "#page-end#",
    ],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "hasılat",
        keyword: ["hasılat", "Hasılat (net)", "Satışlar", "gelirler"],
      },
      {
        chosenLabel: "esas faaliyet karı",
        keyword: [
          "esas faaliyet karı",
          "esas faaliyet kârı",
          "esas faaliyet karı veya (zararı)",
          "esas faaliyet karı/(zararı)",
          "esas faaliyet (zararı) / karı",
          "Esas faaliyet (zararı) karı",
          "Esas faaliyet (zararı)",
          "faaliyet karı / (zararı)",
          "Esas Faaliyet Karı/Zararı",
          "esas faaliyet zararı",
          "ESAS FAALİYET KAR / (ZARARI)",
          "ESAS FAALİYET KARI (ZARARI)",
          "Esas faaliyet karı/zararı",
          "Esas Faaliyet Kârı/Zararı",
          "ESAS FAALİYET KÂRI / (ZARARI)",
          "esas faaliyet kârı / (zararı)",
          "Esas Faaliyet Karı / Zararı (-)",
          "Esas faaliyet kar (zararı)",
          "ESAS FAALİYET ZARARI",
          "faaliyet karı",
        ],
      },
      {
        chosenLabel: "ana ortaklık payları",
        keyword: [
          "ana ortaklık payları",
          "-ana ortaklık payları",
          "- ana ortaklık payları",
          "kontrol gücü olmayan paylar ana ortaklık payları",
          "net dönem karı",
          "dönem zararı",
          "dönem net karı",
          "dönem karı",
          "dönem karı (zararı)",
          "Dönem karı / (zararı)",
          "dönem karı veya (zararı)",
          "dönem net karı/(zararı)",
          "Dönem Net Karı/Zararı",
          "Net dönem kârı",
          "net dönem karı / (zararı)",
          "DÖNEM KARI (ZARARI)",
          "DÖNEM KARI/ZARARI",
          "Sürdürülen Faaliyetler Net Dönem Karı",
          "Sürdürülen faaliyetler dönem karı",
          "sürdürülen faaliyetler dönem karı (zararı)",
          "Sürdürülen faaliyetler net dönem karı/(zararı)",
        ],
      },
    ],
  },
};
