/* public/firebase-config.js – Firebase Web SDK Integration */

const firebaseConfig = {
  apiKey: "AIzaSyBRfOyoZG6C4hoMaile-dkF6tJ7O-7yzns",
  authDomain: "gamify-3eb7e.firebaseapp.com",
  projectId: "gamify-3eb7e",
  storageBucket: "gamify-3eb7e.firebasestorage.app",
  messagingSenderId: "817102109308",
  appId: "1:817102109308:web:45b18a78a2315b1409e7f9",
  measurementId: "G-SJ4S6VD7N9"
};

// Initialize Firebase App & Auth
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  if (firebase.analytics) {
    try { firebase.analytics(); } catch(e){}
  }
}

// ── FIREBASE AUTH HELPER FUNCTIONS ────────────────────────────

// 1. Sign In / Sign Up with Google Popup
async function signInWithGoogle() {
  if (typeof firebase === 'undefined' || !firebase.auth) {
    throw new Error('Firebase SDK loading error.');
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  const result = await firebase.auth().signInWithPopup(provider);
  return result.user;
}

// 2. Sign In with Email & Password
async function signInWithEmailPass(email, password) {
  if (typeof firebase === 'undefined' || !firebase.auth) {
    throw new Error('Firebase SDK loading error.');
  }
  const result = await firebase.auth().signInWithEmailAndPassword(email, password);
  return result.user;
}

// 3. Sign Up with Email & Password
async function signUpWithEmailPass(email, password) {
  if (typeof firebase === 'undefined' || !firebase.auth) {
    throw new Error('Firebase SDK loading error.');
  }
  const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
  return result.user;
}

// 4. Sign Out
async function signOutCustomer() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    await firebase.auth().signOut();
  }
}

// 5. Auth State Observer
function onAuthStateChange(callback) {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(user => {
      callback(user);
    });
  }
}
