export type TreatmentCategory =
  | "visage"
  | "corps"
  | "regard"
  | "mains"
  | "epilation";

export type Treatment = {
  slug: string;
  name: string;
  category: TreatmentCategory;
  duration: string;
  price: number;
  short: string;
  description: string;
  protocol: string[];
  image: string;
  featured?: boolean;
};

export const site = {
  name: "Maison Liora",
  tagline: "La lumière de votre peau",
  claim: "Institut de beauté d'exception",
  city: "Paris",
  address: "14 rue des Saints-Pères",
  postal: "75007 Paris",
  phone: "01 42 61 28 40",
  phoneHref: "tel:+33142612840",
  email: "contact@maison-liora.fr",
  instagram: "https://instagram.com/maisonliora",
  hours: [
    { days: "Mardi — Vendredi", time: "10h00 – 19h30" },
    { days: "Samedi", time: "9h30 – 18h30" },
    { days: "Dimanche", time: "11h00 – 17h00, sur rendez-vous" },
    { days: "Lundi", time: "Fermé" },
  ],
};

export const categories: { slug: TreatmentCategory; label: string }[] = [
  { slug: "visage", label: "Visage" },
  { slug: "corps", label: "Corps" },
  { slug: "regard", label: "Regard" },
  { slug: "mains", label: "Mains" },
  { slug: "epilation", label: "Épilation" },
];

export const treatments: Treatment[] = [
  {
    slug: "rituel-eclat",
    name: "Rituel Éclat",
    category: "visage",
    duration: "75 min",
    price: 165,
    featured: true,
    short: "Le soin signature. Diagnostic de peau, nettoyage profond et lumière.",
    description:
      "Soin visage signature de la Maison. Un protocole en cinq temps, pensé pour révéler l'éclat sans agresser. Chaque geste est adapté à votre peau du jour : diagnostic à la loupe, nettoyage enzymatique, extraction douce, masque sur-mesure et modelage lumineux. Vous repartez avec une peau nette, reposée, comme après une nuit profonde.",
    protocol: [
      "Diagnostic de peau et prescription du protocole",
      "Double nettoyage et gommage enzymatique",
      "Extraction douce et infusé oxygénant",
      "Masque sur-mesure et modelage du visage",
      "Sérum et protection adaptés à emporter",
    ],
    image:
      "https://images.unsplash.com/photo-1570172619604-42b92985d5ea?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "rituel-or",
    name: "Rituel Or",
    category: "visage",
    duration: "90 min",
    price: 245,
    featured: true,
    short: "Anti-âge précieux. Tenseur, or colloïdal et modelage sculptant.",
    description:
      "Notre rituel le plus confidentiel. Un protocole anti-âge qui allie actifs tensés, or colloïdal et un modelage sculptant inspiré des techniques visagistes. Idéal avant un événement, un voyage ou simplement pour offrir à la peau un temps d'exception. La texture est soyeuse, le résultat immédiat : ovale plus net, ridules apaisées, teint unifié.",
    protocol: [
      "Diagnostic anti-âge et préparation de la peau",
      "Peeling enzymatique doux et drainage lymphatique",
      "Application d'or colloïdal et sérum tenseur",
      "Modelage sculptant du visage, du cou et du décolleté",
      "Masque précieux et protection lumière",
    ],
    image:
      "https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "hydra-eclat",
    name: "Hydra-Éclat",
    category: "visage",
    duration: "60 min",
    price: 125,
    short: "Soin hydratant intense pour peaux ternes, déshydratées ou urbaines.",
    description:
      "Un soin de soif. Pour les peaux qui manquent d'eau, de confort ou de lumière après l'hiver, un vol long-courrier ou trop d'écrans. Acide hyaluronique, aquaporines et un brumisateur d'eau thermale pour une hydratation en profondeur, sans film gras. La peau rebondit, le grain se resserre, le teint s'éclaire.",
    protocol: [
      "Nettoyage lacté et gommage hydratant",
      "Sérum d'acide hyaluronique en couches",
      "Masque crème et modelage des tissus",
      "Brume thermale et crème de confort",
    ],
    image:
      "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "regard-precieux",
    name: "Regard Précieux",
    category: "regard",
    duration: "45 min",
    price: 95,
    featured: true,
    short: "Sourcils, cils et contour de l'œil. Un regard net, reposé, couture.",
    description:
      "Le regard est la première signature. Ce soin combine restructuration des sourcils, teinture végétale si besoin, et un protocole contour de l'œil pour dégonfler, lisser et illuminer. Les cils sont nourris, les sourcils dessinés selon l'architecture du visage, jamais selon une mode.",
    protocol: [
      "Analyse de l'architecture du regard",
      "Restructuration et teinture végétale des sourcils",
      "Soin cils et contour de l'œil drainant",
      "Finition poudre et conseil d'entretien",
    ],
    image:
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "extensions-cils",
    name: "Cils Couture",
    category: "regard",
    duration: "90 min",
    price: 140,
    short: "Pose cil à cil, volume russe léger. Naturel, durable, sans surcharge.",
    description:
      "Une pose cil à cil ou un volume russe léger, selon l'ouverture de votre œil et votre rythme de vie. Nous refusons les poses trop denses qui fatiguent la frange naturelle. Entretien toutes les trois semaines. Retrait compris si vous changez de protocole.",
    protocol: [
      "Consultation et choix de la carte de cils",
      "Préparation et isolation de la frange",
      "Pose cil à cil ou volume russe léger",
      "Contrôle, brossage et consignes d'entretien",
    ],
    image:
      "https://images.unsplash.com/photo-1583001931096-959e9a1a6223?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "corps-ambre",
    name: "Rituel Corps Ambre",
    category: "corps",
    duration: "80 min",
    price: 185,
    featured: true,
    short: "Gommage précieux, enveloppement et modelage à l'huile d'ambre.",
    description:
      "Un rituel complet pour le corps, comme un voyage. Gommage aux sucres et à l'ambre, enveloppement tiède, puis modelage à l'huile sèche parfumée. La peau est satinée, les tensions du dos et des épaules se relâchent. Idéal en cadeau, avant un départ ou au changement de saison.",
    protocol: [
      "Gommage corps aux sucres et ambre",
      "Enveloppement tiède et repos guidé",
      "Modelage à l'huile sèche, dos et jambes",
      "Brume corporelle et conseil de rituel maison",
    ],
    image:
      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "massage-liora",
    name: "Massage Liora",
    category: "corps",
    duration: "60 min",
    price: 155,
    short: "Modelage signature, pressions lentes, huiles chaudes. Corps et esprit.",
    description:
      "Ni sportif, ni impersonnel. Un modelage aux pressions lentes, huiles chaudes et respirations guidées. Nous travaillons le dos, la nuque, les épaules et les jambes selon vos tensions du jour. Un temps pour redescendre, sans musique trop forte ni discours superflu.",
    protocol: [
      "Entretien des tensions et choix de l'huile",
      "Modelage du dos, de la nuque et des épaules",
      "Travail des jambes et des pieds",
      "Repos et verre d'eau tiède infusée",
    ],
    image:
      "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "manucure-soie",
    name: "Manucure Soie",
    category: "mains",
    duration: "50 min",
    price: 75,
    short: "Soin des cuticules, limage couture et vernis longue tenue.",
    description:
      "Une manucure de maison, pas un passage express. Soin des cuticules, limage dans le sens de la pousse, massage des mains à l'huile de camélia, puis vernis classique ou semi-permanent. La couleur est choisie avec vous, jamais imposée. Pose soignée, bords nets, tenue de deux semaines en semi-permanent.",
    protocol: [
      "Bain des mains et soin des cuticules",
      "Limage et mise en forme couture",
      "Massage à l'huile de camélia",
      "Vernis classique ou semi-permanent",
    ],
    image:
      "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "gel-couture",
    name: "Gel Couture",
    category: "mains",
    duration: "70 min",
    price: 95,
    short: "Renforcement gel naturel. Ongles fins, cassants, ou qui poussent mal.",
    description:
      "Pour les ongles qui se fendent, qui ne poussent pas ou qui manquent de structure. Un renforcement gel très fin, presque invisible, qui protège sans transformer la main. Retrait propre, jamais de limage agressif de la plaque.",
    protocol: [
      "Diagnostic de la plaque et préparation",
      "Pose de gel de structure très fin",
      "Façonnage et lissage",
      "Couleur ou fini naturel, huile de finition",
    ],
    image:
      "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=1600&q=80",
  },
  {
    slug: "epilation-precision",
    name: "Épilation de précision",
    category: "epilation",
    duration: "20–45 min",
    price: 38,
    short: "Cire tiède de haute qualité. Visage, aisselles, jambes, maillot.",
    description:
      "Une épilation nette, sans précipitation. Cire tiède hypoallergénique, bandes ou cire jetable selon la zone. Nous travaillons dans le sens du poil, hydratons après, et indiquons le bon rythme pour que le poil s'affine. Tarif selon la zone, indiqué à la réservation.",
    protocol: [
      "Préparation de la peau et choix de la cire",
      "Épilation précise, zone par zone",
      "Soin apaisant post-épilation",
      "Conseil de rythme et d'entretien",
    ],
    image:
      "https://images.unsplash.com/photo-1519824145371-296454c2c61a?auto=format&fit=crop&w=1600&q=80",
  },
];

export const team = [
  {
    name: "Camille Moreau",
    role: "Fondatrice, visagiste",
    bio: "Quinze ans de cabine, un passage en institut parisien confidentiel, puis l'envie d'une maison à elle. Camille construit chaque protocole autour du visage, jamais autour d'une machine.",
    image:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80",
  },
  {
    name: "Inès Benali",
    role: "Experte regard",
    bio: "Sourcils, cils, teinture végétale. Inès lit l'architecture d'un visage en quelques secondes et refuse les poses trop denses. Son credo : un regard que l'on remarque, pas que l'on déchiffre.",
    image:
      "https://images.unsplash.com/photo-1531123897727-8f1bd90c4f8d?auto=format&fit=crop&w=800&q=80",
  },
  {
    name: "Léa Fontaine",
    role: "Soins corps & modelage",
    bio: "Ancienne danseuse, Léa a une lecture très fine des tensions. Ses massages sont lents, précis, sans spectacle. Elle prépare aussi les rituels corps de la Maison.",
    image:
      "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=800&q=80",
  },
];

export const testimonials = [
  {
    quote:
      "J'ai enfin trouvé un institut où l'on ne me vend pas trois sérums à la sortie. Le Rituel Éclat a changé ma peau d'hiver. Je reviens toutes les six semaines, comme on revient chez un bon tailleur.",
    author: "Claire D.",
    detail: "Cliente depuis 2023",
  },
  {
    quote:
      "Le regard est d'une précision rare. Mes sourcils sont nets sans être dessinés. On se sent attendue, jamais enchaînée. C'est exactement l'esprit que je cherchais dans le 7e.",
    author: "Sofia M.",
    detail: "Regard Précieux",
  },
  {
    quote:
      "J'ai offert le Rituel Corps Ambre à ma sœur. Elle m'a appelée le soir même. La cabine, le silence, l'huile : tout est juste. On n'est pas dans un spa d'hôtel.",
    author: "Hélène P.",
    detail: "Carte cadeau",
  },
];

export const faqs = [
  {
    q: "Comment réserver ?",
    a: "En ligne via la page Réserver, par téléphone au 01 42 61 28 40, ou par e-mail. Nous confirmons chaque demande sous 24 heures ouvées. Un acompte n'est pas demandé pour une première visite.",
  },
  {
    q: "Quelle est la politique d'annulation ?",
    a: "Merci de prévenir au moins 24 heures à l'avance. En deçà, la séance peut être due. Nous sommes souples en cas d'imprévu réel : il suffit d'écrire.",
  },
  {
    q: "Que se passe-t-il lors d'une première visite ?",
    a: "Nous prenons dix minutes de plus. Diagnostic de peau, habitudes, éventuelles contre-indications. Venez démaquillée si possible, ou nous le ferons ensemble. Prévoyez d'arriver cinq minutes en avance.",
  },
  {
    q: "Proposez-vous des cartes cadeaux ?",
    a: "Oui, d'un montant libre ou pour un soin nommé. Elles sont valables un an et s'envoient par e-mail ou se retirent à l'institut. Idéales pour un anniversaire, un départ ou un simple geste.",
  },
  {
    q: "Puis-je venir enceinte ?",
    a: "Oui, à partir du deuxième trimestre, avec l'accord de votre médecin. Nous adaptons les huiles, évitons les huiles essentielles et les protocoles trop drainants. Signalez-le à la réservation.",
  },
  {
    q: "Travaillez-vous uniquement sur rendez-vous ?",
    a: "Oui. La Maison n'accepte pas le passage improvisé, afin de préserver le calme des cabines et le temps dû à chaque cliente.",
  },
];

export const values = [
  {
    title: "Le visage d'abord",
    text: "Nous ne vendons pas de machines. Chaque protocole part d'un diagnostic, d'un geste, d'une lumière. La technique suit le visage, jamais l'inverse.",
  },
  {
    title: "Des formules choisies",
    text: "Peu de marques, très bien connues. Cosmétiques d'exception, textures soyeuses, listes INCI lisibles. Rien n'entre en cabine sans avoir été testé par l'équipe.",
  },
  {
    title: "Un temps véritable",
    text: "Les rendez-vous ne se chevauchent pas. Vous n'entendez pas la cabine d'à côté. Le silence, ici, fait partie du soin.",
  },
];

export const timeSlots = [
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
];

export function getTreatment(slug: string) {
  return treatments.find((item) => item.slug === slug);
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

export function categoryLabel(slug: TreatmentCategory) {
  return categories.find((item) => item.slug === slug)?.label ?? slug;
}
