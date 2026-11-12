# John's Method: the freeze record

Written by scripts/lab/johns-method.ts --freeze on 2026-11-12T06:09Z from commit 39a3574c4d9e35ca0c9200da9a75cfdef537c6f8. The exam run (SPEC.md section 4) reads the json block below and refuses to start unless the tree is clean, nothing but this file changed since the code commit, and SPEC.md and the eight 1-hour files match these hashes.

Verdict of the design years: **the design years did not confirm**. There is no exam run.

```json
{
  "codeCommit": "39a3574c4d9e35ca0c9200da9a75cfdef537c6f8",
  "spec": {
    "path": "/Users/jvdos/jvd-outputs/2026-11-12/johns-method/SPEC.md",
    "sha256": "8a3fede669b435c8674671de4688db408714946c257946113365cfd76441619b"
  },
  "confirmed": false,
  "picked": null,
  "candidatesTried": [
    {
      "pair": "DH4",
      "expiry": "X3",
      "confirmed": false,
      "why": ["year 2 has 28 trades (under 30)", "year 2 total -3.77R (not above 0)"]
    }
  ],
  "filters": [],
  "filterSearch": "not run (no confirmed base)",
  "passOdds": "not run (no confirmed base)",
  "files": {
    "/Users/jvdos/jvd-outputs/trading/history-majors/EURUSD/EURUSD_1h.csv.gz": {
      "size": 887579,
      "sha256": "110de2ee335462f44509ca3956416818f4a474a267f93998f60704e0144c978e"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/GBPUSD/GBPUSD_1h.csv.gz": {
      "size": 897258,
      "sha256": "d8a09e5c18560311768c80130236740604f51f092555b59ec3ccde721291a691"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/USDJPY/USDJPY_1h.csv.gz": {
      "size": 895226,
      "sha256": "1f5a78689ba3dfe7a29108950291e46a3934c5505935a4bad18a1f26d0072910"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/AUDUSD/AUDUSD_1h.csv.gz": {
      "size": 874135,
      "sha256": "9ff4934ea0ebbc4347b7f33d0a390191a12bbe1da4bb1224219e11440541f4ae"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/USDCHF/USDCHF_1h.csv.gz": {
      "size": 870643,
      "sha256": "fe88134d34f44be32b9bbf4eca7d0ba8ee820a85266fac729aff98e03f1e34cd"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/USDCAD/USDCAD_1h.csv.gz": {
      "size": 881024,
      "sha256": "05eb352a237a95cf0e3a514b7b9714432a2fff51c2656c2e6e8f095547af9ca5"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/NZDUSD/NZDUSD_1h.csv.gz": {
      "size": 866658,
      "sha256": "8ccfc137352cf5f6f737ce4b17ef18e003407bd63895d34ca29240e46bd87e53"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/XAUUSD/XAUUSD_1h.csv.gz": {
      "size": 981072,
      "sha256": "47c73eddec3303ab9a920cd63262905e23106b4e0fb72870d91c890ed6d705f9"
    },
    "/Users/jvdos/jvd-outputs/trading/history-majors/manifest.json": {
      "size": 22209,
      "sha256": "27c2dde0d87b35e31fa8f971ad2c3250271459ebf4bc2679f960213b40564382"
    }
  },
  "dataManifestSha256": "9659bc4474cadf3f479ad48697a8e554b3db97d276024c40e2a3753d66f639b6",
  "designTradeListsSha256": {
    "JM-H4H1-X1-C/y1-account-trades.csv": "69e7496c1de2d6ba356d31125f32820ed0f79f88ba50c7473ca813e3c8b90e74",
    "JM-H4H1-X1-C/y1-signal-trades.csv": "10b891b9a3897b81480332517543d31872d0ed3d0343de5ec5df637c1a51d304",
    "JM-H4H1-X1-C/y2-account-trades.csv": "9fcf22d5e965ba6c637677fbfe86317500d12b8287e9b91e0a4a8c4f2d8a34cf",
    "JM-H4H1-X1-C/y2-signal-trades.csv": "a7cac569c49f7d193f875f1251857ab2c14e89329e4d4a3f70394e410a760984",
    "JM-H4H1-X1-U/y1-account-trades.csv": "96826b36e5698e056b5ef7ed0864a18dcb4500babc4563da42244ff7a3a5fca7",
    "JM-H4H1-X1-U/y1-signal-trades.csv": "2ede7994660362f0b082edf0d71184bb826a988c5b9bd0fb352c7a22dc1a59be",
    "JM-H4H1-X1-U/y2-account-trades.csv": "62ef5997b6b5bfbc211c096893be19b5d81d223304c424e8a707514bbf7a4799",
    "JM-H4H1-X1-U/y2-signal-trades.csv": "e793a6058eda0e380e1054e19e77548ddfb11870eccbc20c7ea9301c6e1cb59b",
    "JM-H4H1-X1-A/y1-account-trades.csv": "827afca2b878e305282810a4741b9a9564bbffc8fe2f3ad8249d8cdcefb50bc6",
    "JM-H4H1-X1-A/y1-signal-trades.csv": "e6220f3bb06b1002e3425c69f881448631a483af737ee078773c467f9321ab4e",
    "JM-H4H1-X1-A/y2-account-trades.csv": "0dbbe31c840f940042c3346a73953fb304ba4beb5f899dad244244ee36c54dc1",
    "JM-H4H1-X1-A/y2-signal-trades.csv": "6c2cc888f01ee3e0b36b996f5ca34cee7aae7b49c5c659302a545ec535ce5d02",
    "JM-H4H1-X2-C/y1-account-trades.csv": "f4040ab9a394b3512fd6f2eec808137777db2f00c2fb84b7857cefa2a287e005",
    "JM-H4H1-X2-C/y1-signal-trades.csv": "84609a187255cca6bf81cacc8de996b5a27d87082772defbc651ccdb8f961560",
    "JM-H4H1-X2-C/y2-account-trades.csv": "855677304d10f0395a38fc5a1533b4a4220a3bf923475d4de5c759df15534d3b",
    "JM-H4H1-X2-C/y2-signal-trades.csv": "3fa3848f965ad9d6659952d4f5255b448d9ca498879104d347935f81807374a8",
    "JM-H4H1-X2-U/y1-account-trades.csv": "e5d20ed09b6c2a147aed09747755b6ef459f924bfdc449e6d67f625897b3ad92",
    "JM-H4H1-X2-U/y1-signal-trades.csv": "553af811147325613ece3e63d3238f6c76c823fb1f42543f5b832847cc395c49",
    "JM-H4H1-X2-U/y2-account-trades.csv": "17051fc347e607b39b758003e036003c07a9e382deca3cb73f673cc5d64b36c9",
    "JM-H4H1-X2-U/y2-signal-trades.csv": "99e48a6d0ccf30d8aa9d984b42e1b4e3b8b3833c0720a4b97305da946d8886de",
    "JM-H4H1-X2-A/y1-account-trades.csv": "a383d97d6139b852d68c3e1f9428c455831ec4c4924f74958f62bef3027888cf",
    "JM-H4H1-X2-A/y1-signal-trades.csv": "9ffc26edefb912e125847d72b97567acc76823e3465c090b045ec9428a7a3bbb",
    "JM-H4H1-X2-A/y2-account-trades.csv": "73cf47f7d565b25ec3a9e9ed5b5e752993487170d50c167a431758944c896a48",
    "JM-H4H1-X2-A/y2-signal-trades.csv": "93204c36503c4143184604202ac8b9346cd9d69262e2749470a8fdde4b520db3",
    "JM-H4H1-X3-C/y1-account-trades.csv": "0f1b3cdffa0164a2c9cca6dcd3e2f94c6f99465a132a73ce96594c4c2e1941c2",
    "JM-H4H1-X3-C/y1-signal-trades.csv": "95539d903213f3524e256d2c86e44b9d5fbb90fc238c5c76c9eb375e4e46a302",
    "JM-H4H1-X3-C/y2-account-trades.csv": "4057766ddc4db7112229d05f9e5dd51eb29eace2f2bd68f207f71750a7df6e6e",
    "JM-H4H1-X3-C/y2-signal-trades.csv": "5dec19515f2834c91299dcce2cd9e3f10e5f35780bbee4f3294d3d44e9e8cb7a",
    "JM-H4H1-X3-U/y1-account-trades.csv": "0e0d718c326c21682f540094ce3800ae7304f36aa7eb59163f2df3bfce62d603",
    "JM-H4H1-X3-U/y1-signal-trades.csv": "1aaacd9dea1f8d7a029a446a80129df734a74f6a8950f675f073dd71b2fc8377",
    "JM-H4H1-X3-U/y2-account-trades.csv": "5a41f42f771ae79cd45c65822b5d93c65addee4b94f39037050b47fb8971e749",
    "JM-H4H1-X3-U/y2-signal-trades.csv": "48d91a6b239a85b5b5538051a3b594a356ac60e3e8c1c4447cba2b3a16b1ed1d",
    "JM-H4H1-X3-A/y1-account-trades.csv": "055a88f201482e7f5f15276d70c5b113f8027940d63b58959cf55e1813229b05",
    "JM-H4H1-X3-A/y1-signal-trades.csv": "218fc7930e3c5fa84ef91ce158ed056a6d585bfcfde70ce9084d7f67db0fd3fa",
    "JM-H4H1-X3-A/y2-account-trades.csv": "8253ae6fb906a33440ebdb59ca8a9a6fc985d05112551cd00f678cf187eb3e2a",
    "JM-H4H1-X3-A/y2-signal-trades.csv": "fc6831075938e2f5eebd95a17b8ac67dafc89fcbeb7a2e6203bccf3fa62bc2d7",
    "JM-DH4-X1-C/y1-account-trades.csv": "42b91a22b5cfac85ac3559280b34c703015afa23fc1ec5e2ae4a0c851e3bb756",
    "JM-DH4-X1-C/y1-signal-trades.csv": "a44915627fd92639ded19b1b6e657a75f01df810c469e1e4bca6a94c12b08bb0",
    "JM-DH4-X1-C/y2-account-trades.csv": "32d8e84f017513b7a41c3e7b8741105cf943af9300338297cd96ad75af2e1cd8",
    "JM-DH4-X1-C/y2-signal-trades.csv": "d9d131feb27a17b208fd6ab7ad65b2837757c9b6e629021383189cee6cabecb3",
    "JM-DH4-X1-U/y1-account-trades.csv": "cb48697434aff9c08bc8edd18f2ee9b6b3460498130f917cb0a76ca37256ab7f",
    "JM-DH4-X1-U/y1-signal-trades.csv": "cc0154206f571d5e29feef8fc639ba38865dfe2a161359921505b899252017de",
    "JM-DH4-X1-U/y2-account-trades.csv": "5f333dd28b907a1a973eb187223156965bed1d0a1d4a287be897754654c9161b",
    "JM-DH4-X1-U/y2-signal-trades.csv": "2d914b6ad009bd398c7573aba1847d36de0918a21b3e75ea07e741eaeaec6b87",
    "JM-DH4-X1-A/y1-account-trades.csv": "2f37f0bfc45da8b0b1d37b245cc791e607facc0208594aee775d5ff36bdffdd4",
    "JM-DH4-X1-A/y1-signal-trades.csv": "2af4b77da7267c5cf461e990cfbb9fe2b649a2ee9d6da510bbc3b4c80b4b946f",
    "JM-DH4-X1-A/y2-account-trades.csv": "19113aa44015eec25bf266b017b7e78cf86b38eb105bbc7dee50db39f5c2bf68",
    "JM-DH4-X1-A/y2-signal-trades.csv": "71a3c7bb360973f00e3e28eed564d149d835a8eb375e260f039462ebdeee6a63",
    "JM-DH4-X2-C/y1-account-trades.csv": "6ba2657946d5e955c84b3643ad92aa55b9d3cee7970ee625107a31c5f08d64f3",
    "JM-DH4-X2-C/y1-signal-trades.csv": "f1002fbd7b44606b9d2473103ac3106835556904f763abbf73cc7f8b36d269a4",
    "JM-DH4-X2-C/y2-account-trades.csv": "2899def0a8ab55f9f3c81b601caaded73970f8227f1f7968bf2ab2fb1f485682",
    "JM-DH4-X2-C/y2-signal-trades.csv": "33e9e3b589a3593c36f541cb24874fa2d1ebba840a3bf8efe8f63a38ad11d059",
    "JM-DH4-X2-U/y1-account-trades.csv": "5a9af6c0f4f60b0b2771bd51b2cebc63d20fca313bf54123fe68649920f1880a",
    "JM-DH4-X2-U/y1-signal-trades.csv": "fb8334a517ccb69de97acefa56e095f1a9243a8e0d9a6853a0db3913ab506d24",
    "JM-DH4-X2-U/y2-account-trades.csv": "ab0a4ae616adeba16970d1f7d6241d1855d25fc50e2fa15fb03b5175d03c076b",
    "JM-DH4-X2-U/y2-signal-trades.csv": "ee63862aabd39bbdde7602a2151abec5d263ef256fa282d20504beae1b8bf451",
    "JM-DH4-X2-A/y1-account-trades.csv": "8fd52ac9cc4315a3e3a03249d5529cc1d9789456033528eb6385afc2418c8d8f",
    "JM-DH4-X2-A/y1-signal-trades.csv": "61ebcec66b99085ece68031c88b5ba745c97f23964d9a6ec6aa3fd567eb0053d",
    "JM-DH4-X2-A/y2-account-trades.csv": "7109fb0e31aecab03bb49a81be774c57ab60902061c63382444eb8e114c75d7c",
    "JM-DH4-X2-A/y2-signal-trades.csv": "7e313c751b3e2ccb460d165f0fd888a74064054810d26494de98ec86fa2eee75",
    "JM-DH4-X3-C/y1-account-trades.csv": "38ca6b0c5fae84d1811eba4ed8fe1f5658b46d74fa7e04acb9590f1bb37c6fa2",
    "JM-DH4-X3-C/y1-signal-trades.csv": "67034ea1e143e8177e2e6579eb1254fa464e325ba0af0632b20c2ac5aeab7380",
    "JM-DH4-X3-C/y2-account-trades.csv": "7af1dadd53706e8f89dce966eb0cd1788fca91e74ef4c1955f6f99b4d126dd12",
    "JM-DH4-X3-C/y2-signal-trades.csv": "bef2c88c15e21c6db4a44ba576c7b4701d41361e5ca061c5de948595fba4653b",
    "JM-DH4-X3-U/y1-account-trades.csv": "231bfa7e7719c67995470dec3af6602028fbb43e91148b74d4fb782b8bc02950",
    "JM-DH4-X3-U/y1-signal-trades.csv": "a669a2fd6588ab09af0cb26edcdaafa44364c0b4c03d1037cc6ff9bf552845f6",
    "JM-DH4-X3-U/y2-account-trades.csv": "adb8678e594e5486f997d8696c6c87c21ad9c5b039252e01b9017cd1fa766813",
    "JM-DH4-X3-U/y2-signal-trades.csv": "dd652e110954721ea4d8493f180048e75cdc7bb2a0f4ebb2f7dc9517cc7a96d5",
    "JM-DH4-X3-A/y1-account-trades.csv": "f9f7223ff97b5575d2307262748748791911ab88dbdaf4bb8e2457ea01a4b8b1",
    "JM-DH4-X3-A/y1-signal-trades.csv": "5ee83a2f497bcb548ff01b71cb3587ef343f2a3093562d0a7dc248cf3aca09b0",
    "JM-DH4-X3-A/y2-account-trades.csv": "5172c1beca05fc31f36ebe874175e33bbec105679d672f74448f8a4cb2f63fb9",
    "JM-DH4-X3-A/y2-signal-trades.csv": "d4e57a72935abbbcd14d4a1c08b644bc20696cb16fc9be05fc44cd19f53e3a49"
  },
  "designRuns": {
    "JM-H4H1-X1-C": {
      "y1": {
        "trades": 117,
        "totalR": 5.386262873679487,
        "avgR": 0.0460364348177734,
        "maxDrawdown": 0.2789111036049527,
        "endBalance": 10600.970949655502,
        "signalBookTrades": 223,
        "signalBookTotalR": -29.881560824111688
      },
      "y2": {
        "trades": 119,
        "totalR": -41.23273241194959,
        "avgR": -0.34649354968024865,
        "maxDrawdown": 0.5807974369080656,
        "endBalance": 4225.70756760145,
        "signalBookTrades": 193,
        "signalBookTotalR": -38.35739946559111
      }
    },
    "JM-H4H1-X1-U": {
      "y1": {
        "trades": 117,
        "totalR": 6.083887045485641,
        "avgR": 0.05199903457680035,
        "maxDrawdown": 0.28425741064922433,
        "endBalance": 10729.642159547991,
        "signalBookTrades": 223,
        "signalBookTotalR": -28.317391055036822
      },
      "y2": {
        "trades": 119,
        "totalR": -40.558411498798876,
        "avgR": -0.3408269873848645,
        "maxDrawdown": 0.5756759874421975,
        "endBalance": 4277.333558638774,
        "signalBookTrades": 193,
        "signalBookTotalR": -36.0947972106403
      }
    },
    "JM-H4H1-X1-A": {
      "y1": {
        "trades": 118,
        "totalR": 12.246871863308021,
        "avgR": 0.10378704968905103,
        "maxDrawdown": 0.28481451728708507,
        "endBalance": 12057.120853036366,
        "signalBookTrades": 217,
        "signalBookTotalR": -10.963040725777216
      },
      "y2": {
        "trades": 116,
        "totalR": -44.05702608525772,
        "avgR": -0.3798019490108424,
        "maxDrawdown": 0.6194701338771716,
        "endBalance": 3971.7772216922267,
        "signalBookTrades": 190,
        "signalBookTotalR": -37.082194773671716
      }
    },
    "JM-H4H1-X2-C": {
      "y1": {
        "trades": 125,
        "totalR": 2.9001391943258668,
        "avgR": 0.023201113554606936,
        "maxDrawdown": 0.29944786547729746,
        "endBalance": 10016.405367125266,
        "signalBookTrades": 223,
        "signalBookTotalR": -26.823846266123816
      },
      "y2": {
        "trades": 123,
        "totalR": -31.231188369777993,
        "avgR": -0.25391210056730074,
        "maxDrawdown": 0.5186415259170147,
        "endBalance": 5143.649513894738,
        "signalBookTrades": 203,
        "signalBookTotalR": -24.687034557179125
      }
    },
    "JM-H4H1-X2-U": {
      "y1": {
        "trades": 125,
        "totalR": 4.1715025521673805,
        "avgR": 0.03337202041733905,
        "maxDrawdown": 0.30189419542571083,
        "endBalance": 10235.827105306073,
        "signalBookTrades": 223,
        "signalBookTotalR": -25.739555204430083
      },
      "y2": {
        "trades": 123,
        "totalR": -31.429033429971412,
        "avgR": -0.2555205969916375,
        "maxDrawdown": 0.5208543759481847,
        "endBalance": 5120.6009320218645,
        "signalBookTrades": 203,
        "signalBookTotalR": -26.05606817723235
      }
    },
    "JM-H4H1-X2-A": {
      "y1": {
        "trades": 122,
        "totalR": 7.18595216079968,
        "avgR": 0.05890124721966951,
        "maxDrawdown": 0.31903286581655094,
        "endBalance": 10861.425099451633,
        "signalBookTrades": 221,
        "signalBookTotalR": -18.67760186170434
      },
      "y2": {
        "trades": 119,
        "totalR": -33.43191309763726,
        "avgR": -0.28094044619863245,
        "maxDrawdown": 0.5636761367729365,
        "endBalance": 4850.167607391084,
        "signalBookTrades": 200,
        "signalBookTotalR": -22.80541956897024
      }
    },
    "JM-H4H1-X3-C": {
      "y1": {
        "trades": 137,
        "totalR": 3.5972667248786983,
        "avgR": 0.02625742134947955,
        "maxDrawdown": 0.30867082271515983,
        "endBalance": 10131.425319815047,
        "signalBookTrades": 255,
        "signalBookTotalR": -23.45284622929071
      },
      "y2": {
        "trades": 132,
        "totalR": -18.77512372832206,
        "avgR": -0.14223578582062169,
        "maxDrawdown": 0.4295996141363793,
        "endBalance": 6489.0152691695685,
        "signalBookTrades": 240,
        "signalBookTotalR": -32.06829479534374
      }
    },
    "JM-H4H1-X3-U": {
      "y1": {
        "trades": 137,
        "totalR": 5.580304203581977,
        "avgR": 0.04073214747140129,
        "maxDrawdown": 0.3110849460719551,
        "endBalance": 10544.028616242937,
        "signalBookTrades": 255,
        "signalBookTotalR": -22.99120546534779
      },
      "y2": {
        "trades": 132,
        "totalR": -20.124533057181054,
        "avgR": -0.15245858376652313,
        "maxDrawdown": 0.4375551647562718,
        "endBalance": 6319.935722977406,
        "signalBookTrades": 240,
        "signalBookTotalR": -34.17178857560467
      }
    },
    "JM-H4H1-X3-A": {
      "y1": {
        "trades": 136,
        "totalR": -7.874646845662609,
        "avgR": -0.05790181504163683,
        "maxDrawdown": 0.3786810466829016,
        "endBalance": 8020.890645108504,
        "signalBookTrades": 252,
        "signalBookTotalR": -12.105599453652559
      },
      "y2": {
        "trades": 130,
        "totalR": -37.63067236870064,
        "avgR": -0.28946671052846645,
        "maxDrawdown": 0.5724777095872752,
        "endBalance": 4436.500204769169,
        "signalBookTrades": 238,
        "signalBookTotalR": -38.726841428154046
      }
    },
    "JM-DH4-X1-C": {
      "y1": {
        "trades": 25,
        "totalR": 3.819317541787372,
        "avgR": 0.1527727016714949,
        "maxDrawdown": 0.1294934580743938,
        "endBalance": 10610.319169955446,
        "signalBookTrades": 41,
        "signalBookTotalR": -6.387905978583708
      },
      "y2": {
        "trades": 20,
        "totalR": 5.0945419824272,
        "avgR": 0.25472709912136,
        "maxDrawdown": 0.12965540612541596,
        "endBalance": 10931.543548056652,
        "signalBookTrades": 42,
        "signalBookTotalR": -1.2483475951596399
      }
    },
    "JM-DH4-X1-U": {
      "y1": {
        "trades": 25,
        "totalR": 4.60769660241425,
        "avgR": 0.18430786409657,
        "maxDrawdown": 0.12631743339550275,
        "endBalance": 10778.667024799754,
        "signalBookTrades": 41,
        "signalBookTotalR": -5.052899361859069
      },
      "y2": {
        "trades": 20,
        "totalR": 5.475949947612354,
        "avgR": 0.2737974973806177,
        "maxDrawdown": 0.12265382298041604,
        "endBalance": 11018.67978790678,
        "signalBookTrades": 42,
        "signalBookTotalR": -1.8702297048555017
      }
    },
    "JM-DH4-X1-A": {
      "y1": {
        "trades": 25,
        "totalR": -0.013481334050681415,
        "avgR": -0.0005392533620272567,
        "maxDrawdown": 0.15602012214144612,
        "endBalance": 9858.659472934756,
        "signalBookTrades": 41,
        "signalBookTotalR": -10.322951218237623
      },
      "y2": {
        "trades": 20,
        "totalR": 11.646200120558033,
        "avgR": 0.5823100060279016,
        "maxDrawdown": 0.12173586487564665,
        "endBalance": 12370.129284837265,
        "signalBookTrades": 41,
        "signalBookTotalR": 9.224714993030704
      }
    },
    "JM-DH4-X2-C": {
      "y1": {
        "trades": 29,
        "totalR": 7.780110875942012,
        "avgR": 0.26827968537731073,
        "maxDrawdown": 0.09126609079291463,
        "endBalance": 11422.047323790097,
        "signalBookTrades": 41,
        "signalBookTotalR": -2.517908101104636
      },
      "y2": {
        "trades": 25,
        "totalR": -4.490529883997051,
        "avgR": -0.17962119535988205,
        "maxDrawdown": 0.18291414939287115,
        "endBalance": 9064.55552489163,
        "signalBookTrades": 41,
        "signalBookTotalR": -6.185430764988287
      }
    },
    "JM-DH4-X2-U": {
      "y1": {
        "trades": 29,
        "totalR": 7.602361067880451,
        "avgR": 0.26215038165105004,
        "maxDrawdown": 0.09126609079291463,
        "endBalance": 11389.797314287101,
        "signalBookTrades": 41,
        "signalBookTotalR": -2.455638806298273
      },
      "y2": {
        "trades": 25,
        "totalR": -4.500250481848144,
        "avgR": -0.18001001927392576,
        "maxDrawdown": 0.18305465361376047,
        "endBalance": 9062.996804579943,
        "signalBookTrades": 41,
        "signalBookTotalR": -6.944975514025704
      }
    },
    "JM-DH4-X2-A": {
      "y1": {
        "trades": 29,
        "totalR": 0.7478771591597163,
        "avgR": 0.025788867557231598,
        "maxDrawdown": 0.142755104833761,
        "endBalance": 9970.801685594888,
        "signalBookTrades": 41,
        "signalBookTotalR": -9.77693204211861
      },
      "y2": {
        "trades": 25,
        "totalR": -1.9007082498851526,
        "avgR": -0.07602832999540611,
        "maxDrawdown": 0.17746981185833996,
        "endBalance": 9496.350758424367,
        "signalBookTrades": 41,
        "signalBookTotalR": -2.8894485166824087
      }
    },
    "JM-DH4-X3-C": {
      "y1": {
        "trades": 35,
        "totalR": -1.4377735321713998,
        "avgR": -0.041079243776325707,
        "maxDrawdown": 0.15815180797848397,
        "endBalance": 9530.481933322797,
        "signalBookTrades": 49,
        "signalBookTotalR": -5.5022093802281
      },
      "y2": {
        "trades": 28,
        "totalR": -3.768219212587213,
        "avgR": -0.13457925759240047,
        "maxDrawdown": 0.14022449024530448,
        "endBalance": 9178.655727830188,
        "signalBookTrades": 43,
        "signalBookTotalR": -8.033770998694761
      }
    },
    "JM-DH4-X3-U": {
      "y1": {
        "trades": 35,
        "totalR": -0.9460976896709812,
        "avgR": -0.027031362562028035,
        "maxDrawdown": 0.13882656340043517,
        "endBalance": 9638.341103892593,
        "signalBookTrades": 49,
        "signalBookTotalR": -4.609793339093857
      },
      "y2": {
        "trades": 28,
        "totalR": -3.8176693826416246,
        "avgR": -0.13634533509434374,
        "maxDrawdown": 0.14117915386947422,
        "endBalance": 9168.464080542355,
        "signalBookTrades": 43,
        "signalBookTotalR": -8.966664236203501
      }
    },
    "JM-DH4-X3-A": {
      "y1": {
        "trades": 34,
        "totalR": -7.394519639963629,
        "avgR": -0.21748587176363612,
        "maxDrawdown": 0.21885971994212405,
        "endBalance": 8471.414952102848,
        "signalBookTrades": 48,
        "signalBookTotalR": -14.293784446941942
      },
      "y2": {
        "trades": 28,
        "totalR": -4.995265251276966,
        "avgR": -0.1784023304027488,
        "maxDrawdown": 0.19972567598468438,
        "endBalance": 8898.584010503468,
        "signalBookTrades": 43,
        "signalBookTotalR": -3.7816064073044675
      }
    }
  },
  "window": {
    "from": "2019-01-01",
    "to": "2024-11-10"
  },
  "designOutput": "/Users/jvdos/jvd-outputs/2026-11-12/johns-method/design-run"
}
```
