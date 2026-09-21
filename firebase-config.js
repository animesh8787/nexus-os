/* ============================================================
   Nexus OS — deployment config. Fill this in once; see README "Setup".

   firebase   Firebase Console -> Project settings -> Your apps -> Web app.
              These values identify your project; they are NOT secrets
              (access is enforced by Firebase Auth rules, not by hiding them).
   api        URL of the Groq proxy Worker (see /worker). Leave "" to fall
              back to each user's own Groq key, entered in Settings.
   googleClientId
              OAuth "Web client" ID from the same Google Cloud project.
              Enables the read-only Gmail sync on the Job Tracker.

   operatorName / contactEmail
              Shown in the Privacy Policy and Terms. REQUIRED before you launch:
              Google's app verification and the law both expect a real contact.
   sync       Set to false to turn cloud sync (Firestore) off.

   While firebase.apiKey is empty the app runs in LOCAL MODE: no sign-in,
   data stays in this browser. That is also how you develop it.
   ============================================================ */
window.NEXUS_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBgCBvLPcdkn89Sx89_sJHPYrqtLiFnRpg",
    authDomain: "nexus-os-87.firebaseapp.com",
    projectId: "nexus-os-87",
    appId: "1:900786677594:web:085d49be7f1dd322ca7563",
    messagingSenderId: "900786677594",
    storageBucket: "nexus-os-87.firebasestorage.app"
  },
  api: "",
  googleClientId: "",
  operatorName: "",
  contactEmail: "",
  sync: true
};
