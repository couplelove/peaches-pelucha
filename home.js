import { h } from "https://esm.sh/preact@10.23.2";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* Daily home-screen content: a rotating scripture, deterministic from the DATE
   so both phones show the same words all day and they change overnight. */

const dayIndex = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

/* ---- rotating scripture (KJV) ----
   A wide spread of themes — love, peace, courage, gratitude, hope, wisdom,
   creation, kindness, provision, home, morning & evening — so the card never
   feels like the same subject twice in a week. Longer passages are welcome;
   the card shrinks its type to fit them. */
const VERSES = [
  // love & charity
  ["And now abideth faith, hope, charity, these three; but the greatest of these is charity.", "1 Corinthians 13:13"],
  ["Two are better than one; because they have a good reward for their labour.", "Ecclesiastes 4:9"],
  ["Many waters cannot quench love, neither can the floods drown it.", "Song of Solomon 8:7"],
  ["A friend loveth at all times.", "Proverbs 17:17"],
  ["We love him, because he first loved us.", "1 John 4:19"],
  ["Whither thou goest, I will go; and where thou lodgest, I will lodge.", "Ruth 1:16"],
  ["And above all these things put on charity, which is the bond of perfectness.", "Colossians 3:14"],
  ["And above all things have fervent charity among yourselves: for charity shall cover the multitude of sins.", "1 Peter 4:8"],
  ["This is the day which the Lord hath made; we will rejoice and be glad in it.", "Psalm 118:24"],
  ["And a threefold cord is not quickly broken.", "Ecclesiastes 4:12"],
  ["Let not mercy and truth forsake thee: bind them about thy neck.", "Proverbs 3:3"],
  ["This is my commandment, That ye love one another, as I have loved you.", "John 15:12"],
  ["Be kindly affectioned one to another with brotherly love.", "Romans 12:10"],
  ["Let all your things be done with charity.", "1 Corinthians 16:14"],
  ["Delight thyself also in the Lord; and he shall give thee the desires of thine heart.", "Psalm 37:4"],
  ["I thank my God upon every remembrance of you.", "Philippians 1:3"],
  ["Let thy fountain be blessed: and rejoice with the wife of thy youth.", "Proverbs 5:18"],
  ["The Lord watch between me and thee, when we are absent one from another.", "Genesis 31:49"],
  ["Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up, doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil.", "1 Corinthians 13:4–5"],
  ["Beareth all things, believeth all things, hopeth all things, endureth all things. Charity never faileth.", "1 Corinthians 13:7–8"],
  ["Beloved, let us love one another: for love is of God; and every one that loveth is born of God, and knoweth God.", "1 John 4:7"],
  ["There is no fear in love; but perfect love casteth out fear.", "1 John 4:18"],
  ["Set me as a seal upon thine heart, as a seal upon thine arm: for love is strong as death.", "Song of Solomon 8:6"],
  ["My beloved is mine, and I am his.", "Song of Solomon 2:16"],
  ["I am my beloved's, and my beloved is mine.", "Song of Solomon 6:3"],
  ["Rise up, my love, my fair one, and come away. For, lo, the winter is past, the rain is over and gone; the flowers appear on the earth; the time of the singing of birds is come.", "Song of Solomon 2:10–12"],
  ["Greater love hath no man than this, that a man lay down his life for his friends.", "John 15:13"],
  ["Owe no man any thing, but to love one another: for he that loveth another hath fulfilled the law.", "Romans 13:8"],
  ["Though I speak with the tongues of men and of angels, and have not charity, I am become as sounding brass, or a tinkling cymbal.", "1 Corinthians 13:1"],
  ["Let us not love in word, neither in tongue; but in deed and in truth.", "1 John 3:18"],
  // peace & rest
  ["Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid.", "John 14:27"],
  ["Come unto me, all ye that labour and are heavy laden, and I will give you rest.", "Matthew 11:28"],
  ["The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters.", "Psalm 23:1–2"],
  ["He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.", "Psalm 23:3"],
  ["Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.", "Psalm 23:4"],
  ["And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.", "Philippians 4:7"],
  ["Thou wilt keep him in perfect peace, whose mind is stayed on thee: because he trusteth in thee.", "Isaiah 26:3"],
  ["Be still, and know that I am God.", "Psalm 46:10"],
  ["Casting all your care upon him; for he careth for you.", "1 Peter 5:7"],
  ["Great peace have they which love thy law: and nothing shall offend them.", "Psalm 119:165"],
  ["My presence shall go with thee, and I will give thee rest.", "Exodus 33:14"],
  // courage & strength
  ["Be strong and of a good courage; be not afraid, neither be thou dismayed: for the Lord thy God is with thee whithersoever thou goest.", "Joshua 1:9"],
  ["Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.", "Isaiah 41:10"],
  ["I can do all things through Christ which strengtheneth me.", "Philippians 4:13"],
  ["The Lord is my light and my salvation; whom shall I fear? the Lord is the strength of my life; of whom shall I be afraid?", "Psalm 27:1"],
  ["But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.", "Isaiah 40:31"],
  ["God is our refuge and strength, a very present help in trouble.", "Psalm 46:1"],
  ["What time I am afraid, I will trust in thee.", "Psalm 56:3"],
  ["For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.", "2 Timothy 1:7"],
  ["The Lord is my rock, and my fortress, and my deliverer.", "Psalm 18:2"],
  ["Wait on the Lord: be of good courage, and he shall strengthen thine heart.", "Psalm 27:14"],
  // gratitude & joy
  ["O give thanks unto the Lord; for he is good: for his mercy endureth for ever.", "Psalm 107:1"],
  ["In every thing give thanks: for this is the will of God in Christ Jesus concerning you.", "1 Thessalonians 5:18"],
  ["The joy of the Lord is your strength.", "Nehemiah 8:10"],
  ["Make a joyful noise unto the Lord, all ye lands. Serve the Lord with gladness: come before his presence with singing.", "Psalm 100:1–2"],
  ["Enter into his gates with thanksgiving, and into his courts with praise: be thankful unto him, and bless his name.", "Psalm 100:4"],
  ["Rejoice in the Lord alway: and again I say, Rejoice.", "Philippians 4:4"],
  ["Thou wilt shew me the path of life: in thy presence is fulness of joy; at thy right hand there are pleasures for evermore.", "Psalm 16:11"],
  ["Weeping may endure for a night, but joy cometh in the morning.", "Psalm 30:5"],
  ["Bless the Lord, O my soul, and forget not all his benefits.", "Psalm 103:2"],
  ["This is the Lord's doing; it is marvellous in our eyes.", "Psalm 118:23"],
  // hope & trust
  ["Trust in the Lord with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.", "Proverbs 3:5–6"],
  ["For I know the thoughts that I think toward you, saith the Lord, thoughts of peace, and not of evil, to give you an expected end.", "Jeremiah 29:11"],
  ["Now the God of hope fill you with all joy and peace in believing, that ye may abound in hope.", "Romans 15:13"],
  ["Why art thou cast down, O my soul? and why art thou disquieted in me? hope thou in God: for I shall yet praise him.", "Psalm 42:11"],
  ["The Lord is good unto them that wait for him, to the soul that seeketh him.", "Lamentations 3:25"],
  ["It is of the Lord's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.", "Lamentations 3:22–23"],
  ["Commit thy way unto the Lord; trust also in him; and he shall bring it to pass.", "Psalm 37:5"],
  ["And we know that all things work together for good to them that love God.", "Romans 8:28"],
  ["Cast thy burden upon the Lord, and he shall sustain thee.", "Psalm 55:22"],
  ["Be of good cheer; I have overcome the world.", "John 16:33"],
  // wisdom & the way
  ["Thy word is a lamp unto my feet, and a light unto my path.", "Psalm 119:105"],
  ["If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.", "James 1:5"],
  ["The fear of the Lord is the beginning of wisdom.", "Proverbs 9:10"],
  ["A soft answer turneth away wrath: but grievous words stir up anger.", "Proverbs 15:1"],
  ["Pleasant words are as an honeycomb, sweet to the soul, and health to the bones.", "Proverbs 16:24"],
  ["Let the words of my mouth, and the meditation of my heart, be acceptable in thy sight, O Lord, my strength, and my redeemer.", "Psalm 19:14"],
  ["So teach us to number our days, that we may apply our hearts unto wisdom.", "Psalm 90:12"],
  ["Iron sharpeneth iron; so a man sharpeneth the countenance of his friend.", "Proverbs 27:17"],
  ["He hath shewed thee, O man, what is good; and what doth the Lord require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?", "Micah 6:8"],
  ["Better is a dinner of herbs where love is, than a stalled ox and hatred therewith.", "Proverbs 15:17"],
  // creation & wonder
  ["The heavens declare the glory of God; and the firmament sheweth his handywork.", "Psalm 19:1"],
  ["I will praise thee; for I am fearfully and wonderfully made: marvellous are thy works.", "Psalm 139:14"],
  ["In the beginning God created the heaven and the earth.", "Genesis 1:1"],
  ["He telleth the number of the stars; he calleth them all by their names.", "Psalm 147:4"],
  ["I will lift up mine eyes unto the hills, from whence cometh my help. My help cometh from the Lord, which made heaven and earth.", "Psalm 121:1–2"],
  ["The earth is the Lord's, and the fulness thereof; the world, and they that dwell therein.", "Psalm 24:1"],
  ["To every thing there is a season, and a time to every purpose under the heaven.", "Ecclesiastes 3:1"],
  ["He hath made every thing beautiful in his time.", "Ecclesiastes 3:11"],
  ["For as the heavens are higher than the earth, so are my ways higher than your ways, and my thoughts than your thoughts.", "Isaiah 55:9"],
  ["O Lord, how manifold are thy works! in wisdom hast thou made them all: the earth is full of thy riches.", "Psalm 104:24"],
  // kindness & one another
  ["Be ye kind one to another, tenderhearted, forgiving one another, even as God for Christ's sake hath forgiven you.", "Ephesians 4:32"],
  ["Bear ye one another's burdens, and so fulfil the law of Christ.", "Galatians 6:2"],
  ["As we have therefore opportunity, let us do good unto all men.", "Galatians 6:10"],
  ["Confess your faults one to another, and pray one for another.", "James 5:16"],
  ["Be not forgetful to entertain strangers: for thereby some have entertained angels unawares.", "Hebrews 13:2"],
  ["And let us consider one another to provoke unto love and to good works.", "Hebrews 10:24"],
  ["Finally, be ye all of one mind, having compassion one of another, love as brethren, be pitiful, be courteous.", "1 Peter 3:8"],
  ["Let brotherly love continue.", "Hebrews 13:1"],
  ["A new commandment I give unto you, That ye love one another; as I have loved you, that ye also love one another.", "John 13:34"],
  ["And be ye thankful.", "Colossians 3:15"],
  // provision & faithfulness
  ["But my God shall supply all your need according to his riches in glory by Christ Jesus.", "Philippians 4:19"],
  ["The Lord bless thee, and keep thee: the Lord make his face shine upon thee, and be gracious unto thee: the Lord lift up his countenance upon thee, and give thee peace.", "Numbers 6:24–26"],
  ["Every good gift and every perfect gift is from above, and cometh down from the Father of lights.", "James 1:17"],
  ["Faithful is he that calleth you, who also will do it.", "1 Thessalonians 5:24"],
  ["The Lord is nigh unto all them that call upon him.", "Psalm 145:18"],
  ["Hitherto hath the Lord helped us.", "1 Samuel 7:12"],
  ["Because thou hast been my help, therefore in the shadow of thy wings will I rejoice.", "Psalm 63:7"],
  ["For the Lord God is a sun and shield: the Lord will give grace and glory: no good thing will he withhold from them that walk uprightly.", "Psalm 84:11"],
  ["But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.", "Matthew 6:33"],
  ["Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself.", "Matthew 6:34"],
  // home & marriage
  ["Except the Lord build the house, they labour in vain that build it.", "Psalm 127:1"],
  ["Whoso findeth a wife findeth a good thing, and obtaineth favour of the Lord.", "Proverbs 18:22"],
  ["Who can find a virtuous woman? for her price is far above rubies. The heart of her husband doth safely trust in her.", "Proverbs 31:10–11"],
  ["Strength and honour are her clothing; and she shall rejoice in time to come.", "Proverbs 31:25"],
  ["She openeth her mouth with wisdom; and in her tongue is the law of kindness.", "Proverbs 31:26"],
  ["Therefore shall a man leave his father and his mother, and shall cleave unto his wife: and they shall be one flesh.", "Genesis 2:24"],
  ["Behold, how good and how pleasant it is for brethren to dwell together in unity!", "Psalm 133:1"],
  ["But as for me and my house, we will serve the Lord.", "Joshua 24:15"],
  ["House and riches are the inheritance of fathers: and a prudent wife is from the Lord.", "Proverbs 19:14"],
  ["And they twain shall be one flesh: so then they are no more twain, but one flesh.", "Mark 10:8"],
  // morning & evening
  ["Cause me to hear thy lovingkindness in the morning; for in thee do I trust.", "Psalm 143:8"],
  ["My voice shalt thou hear in the morning, O Lord; in the morning will I direct my prayer unto thee, and will look up.", "Psalm 5:3"],
  ["I will both lay me down in peace, and sleep: for thou, Lord, only makest me dwell in safety.", "Psalm 4:8"],
  ["From the rising of the sun unto the going down of the same the Lord's name is to be praised.", "Psalm 113:3"],
  ["O satisfy us early with thy mercy; that we may rejoice and be glad all our days.", "Psalm 90:14"],
  ["The sun shall not smite thee by day, nor the moon by night.", "Psalm 121:6"],
  ["The Lord shall preserve thy going out and thy coming in from this time forth, and even for evermore.", "Psalm 121:8"],
  ["Evening, and morning, and at noon, will I pray, and cry aloud: and he shall hear my voice.", "Psalm 55:17"],
  ["And let the beauty of the Lord our God be upon us: and establish thou the work of our hands upon us.", "Psalm 90:17"],
  ["I laid me down and slept; I awaked; for the Lord sustained me.", "Psalm 3:5"],
];

export function dailyVerse() {
  // stride through the list with a step coprime to its length: deterministic
  // per day, every verse gets its turn, and neighbouring days land in
  // different themed sections instead of walking one subject for a week.
  const N = VERSES.length;
  const [text, ref] = VERSES[(dayIndex() * 37) % N];
  return { text, ref };
}

export function ScriptureCard() {
  const v = dailyVerse();
  const size = v.text.length > 190 ? "xlong" : v.text.length > 120 ? "long" : "";
  return html`<div class="card versecard">
    <blockquote class="verse">
      <p class=${`verse-text ${size}`}>“${v.text}”</p>
      <div class="eyebrow">${v.ref}</div>
    </blockquote>
  </div>`;
}
