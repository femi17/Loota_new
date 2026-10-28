/**
 * The country the hunter is in, and what the game sounds like there (owner, 27 Oct 2026: "it is not only focused on
 * Nigeria but the country which you find yourself"): its words (a motor park or a bus station, a vulcanizer or a tyre
 * shop, an okada or a motorbike taxi), the names of the people in the scenes, the way they talk, and the radio. Nigeria
 * keeps its own flavour; elsewhere the people have names from that part of the world and speak plain English. The
 * game sets the country as the hunter moves (/api/world/country).
 */

let country = "NG";
const listeners = new Set<() => void>();

export const countryNow = () => country;
export function setCountry(code: string | null) {
  const next = code ?? "NG";
  if (next === country) return;
  country = next;
  listeners.forEach((fn) => fn());
}
export function onCountry(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** What's said in Nigeria, or elsewhere. */
export const local = <T>(nigeria: T, elsewhere: T): T => (country === "NG" ? nigeria : elsewhere);

/** The local words for things. */
export const words = () => ({
  /** Where long-distance buses leave from. */
  park: local("motor park", "bus station"),
  /** Who pumps and patches tyres. */
  tyres: local("vulcanizer", "tyre shop"),
  /** A motorbike hired with its rider, or to ride. */
  okada: local("okada", "motorbike"),
});

export type Role = "renter" | "attendant" | "cook" | "vulcanizer" | "mechanic" | "nurse" | "paramedic" | "clerk";

/** Nigeria's people, as they've always been. */
const NIGERIA: Record<Role, string[]> = {
  renter: ["Musa", "Kunle", "Mama Ronke", "Tunde", "Aunty Joy", "Chidi", "Danjuma", "Iya Bola"],
  attendant: ["Chidi", "Musa", "Segun", "Ibrahim", "Emeka", "Yusuf", "Sola"],
  cook: ["Mama Nkechi", "Mama Bisi", "Iya Titi", "Mama Ngozi", "Iya Kemi", "Aunty Amaka", "Mama Ronke"],
  vulcanizer: ["Baba Sule", "Emeka", "Kunle", "Alhaji Musa", "Chinedu"],
  mechanic: ["Oga Tunde", "Mr Bayo", "Kalu", "Mallam Idris", "Uche"],
  nurse: ["Nurse Funmi", "Nurse Aisha", "Nurse Grace", "Nurse Ifeoma", "Nurse Zainab"],
  paramedic: ["Paramedic Tobi", "Paramedic Usman", "Paramedic Ada", "Paramedic Kelechi"],
  clerk: ["Mrs Okafor", "Mr Adeyemi", "Miss Bello", "Mr Danjuma", "Mrs Eze"],
};

/** First names (then family names, for the ticket clerks) by part of the world. */
const REGIONS: { countries: string[]; first: string[]; family: string[] }[] = [
  { countries: ["GH"], first: ["Kwame", "Ama", "Kofi", "Abena", "Yaw", "Akosua", "Kojo", "Efua"], family: ["Mensah", "Owusu", "Boateng", "Asante"] },
  { countries: ["KE", "TZ", "UG", "RW"], first: ["Wanjiru", "Otieno", "Achieng", "Kamau", "Njeri", "Baraka", "Amani", "Zawadi"], family: ["Mwangi", "Ochieng", "Kariuki", "Mutua"] },
  { countries: ["ZA", "ZW", "BW", "NA", "ZM", "MW"], first: ["Thabo", "Lerato", "Sipho", "Naledi", "Themba", "Zanele", "Bongani", "Ayanda"], family: ["Nkosi", "Dlamini", "Mokoena", "Khumalo"] },
  { countries: ["SN", "CI", "CM", "BJ", "TG", "ML", "BF", "NE", "GN", "GA", "CG", "CD", "FR", "BE", "LU", "MC", "CH", "HT"], first: ["Amadou", "Fatou", "Moussa", "Aïcha", "Julien", "Claire", "Ibrahima", "Mariama"], family: ["Diallo", "Traoré", "Martin", "Dubois"] },
  { countries: ["EG", "MA", "DZ", "TN", "LY", "SD", "SA", "AE", "QA", "KW", "BH", "OM", "JO", "LB", "IQ", "SY", "YE"], first: ["Ahmed", "Fatima", "Omar", "Layla", "Youssef", "Mariam", "Khaled", "Nour"], family: ["Hassan", "Haddad", "Mansour", "Saleh"] },
  { countries: ["ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR"], first: ["Carlos", "Lucía", "Javier", "María", "Diego", "Sofía", "Miguel", "Valentina"], family: ["García", "Rodríguez", "López", "Martínez"] },
  { countries: ["PT", "BR", "AO", "MZ", "CV", "GW", "ST"], first: ["João", "Ana", "Pedro", "Beatriz", "Lucas", "Mariana", "Tiago", "Inês"], family: ["Silva", "Santos", "Ferreira", "Costa"] },
  { countries: ["DE", "AT", "LI"], first: ["Lukas", "Anna", "Jonas", "Lena", "Felix", "Mia", "Paul", "Hannah"], family: ["Müller", "Schmidt", "Fischer", "Weber"] },
  { countries: ["IT", "SM", "VA"], first: ["Marco", "Giulia", "Luca", "Chiara", "Matteo", "Sara", "Andrea", "Elena"], family: ["Rossi", "Russo", "Ferrari", "Bianchi"] },
  { countries: ["NL"], first: ["Daan", "Emma", "Sem", "Julia", "Lucas", "Tess", "Finn", "Sophie"], family: ["de Jong", "Jansen", "de Vries", "Bakker"] },
  { countries: ["IN", "PK", "BD", "NP", "LK"], first: ["Arjun", "Priya", "Rahul", "Ananya", "Vikram", "Meera", "Aditya", "Kavya"], family: ["Sharma", "Patel", "Singh", "Iyer"] },
  { countries: ["CN", "TW", "HK", "SG"], first: ["Wei", "Li Na", "Jun", "Mei", "Hao", "Xin", "Lei", "Yan"], family: ["Wang", "Li", "Zhang", "Chen"] },
  { countries: ["JP"], first: ["Haruto", "Yui", "Sota", "Aoi", "Ren", "Sakura", "Yuto", "Hina"], family: ["Sato", "Suzuki", "Takahashi", "Tanaka"] },
  { countries: ["KR"], first: ["Min-jun", "Seo-yeon", "Ji-ho", "Ha-eun", "Do-yun", "Ji-woo", "Seo-jun", "Su-ah"], family: ["Kim", "Lee", "Park", "Choi"] },
  { countries: ["TR"], first: ["Mehmet", "Zeynep", "Mustafa", "Elif", "Emre", "Ayşe", "Can", "Defne"], family: ["Yılmaz", "Kaya", "Demir", "Şahin"] },
  { countries: ["RU", "UA", "BY", "KZ"], first: ["Ivan", "Olga", "Dmitri", "Anna", "Sergei", "Elena", "Alexei", "Natalia"], family: ["Ivanov", "Petrov", "Smirnova", "Kuznetsov"] },
  { countries: ["PH"], first: ["Juan", "Maria", "Jose", "Angel", "Mark", "Princess", "Paolo", "Kristine"], family: ["Santos", "Reyes", "Cruz", "Bautista"] },
];
/** Elsewhere (the United States, Canada, the UK, Australia and the rest). */
const ENGLISH = { first: ["Mike", "Sarah", "Dave", "Jen", "Tom", "Lisa", "Chris", "Amy"], family: ["Smith", "Johnson", "Brown", "Taylor"] };

/** The people in a role's scenes where the hunter is: Nigeria's own, or names from that part of the world. */
export function peopleOf(role: Role): string[] {
  if (country === "NG") return NIGERIA[role];
  const r = REGIONS.find((g) => g.countries.includes(country)) ?? ENGLISH;
  if (role === "nurse") return r.first.map((n) => `Nurse ${n}`);
  if (role === "paramedic") return r.first.map((n) => `Paramedic ${n}`);
  if (role === "clerk") return r.family.map((f, i) => `${i % 2 ? "Ms" : "Mr"} ${f}`);
  return r.first;
}
