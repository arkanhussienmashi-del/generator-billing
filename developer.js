import React, { useState, useEffect, useRef, useMemo, useContext, createContext, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Modal,
  Alert,
  Dimensions,
  ActivityIndicator,
  Linking,
  AppState,
  BackHandler,
  Animated,
  PanResponder,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const IS_TABLET = SCREEN_WIDTH >= 768;
const IS_SMALL = SCREEN_WIDTH < 360;
const MODAL_WIDTH = IS_TABLET ? Math.min(500, SCREEN_WIDTH * 0.7) : Math.min(SCREEN_WIDTH * 0.9, 420);
const SCALE = SCREEN_WIDTH / 375;
import { Ionicons } from '@expo/vector-icons';
import { WhatsAppSupportButton } from './src/features/whatsapp-support';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
var workerReport = require('./src/features/worker-report/buildReport');

import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

Text.defaultProps = { ...(Text.defaultProps || {}), allowFontScaling: false };
TextInput.defaultProps = { ...(TextInput.defaultProps || {}), allowFontScaling: false };

const API_URL = 'https://server-ten-wheat.vercel.app';

async function apiRequest(method, path, body) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const fetchPromise = fetch(`${API_URL}${path}`, opts);
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ ok: false, json: async () => null }), 5000));
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    if (!res.ok) return null;
    try { return await res.json(); } catch (e2) { return null; }
  } catch (e) {
    return null;
  }
}

async function saveToFile(filename, data) {
  await saveLocalCache('app_' + filename, data);
  apiRequest('POST', '/api', { _table: 'app_data', filename, data_value: data }).catch(function() {});
  return { ok: true };
}

async function loadFromFile(filename) {
  const local = await loadLocalCache('app_' + filename);
  apiRequest('GET', `/api?table=app_data&filename=${encodeURIComponent(filename)}`).then(function(result) {
    if (Array.isArray(result) && result.length > 0) {
      var val = result[0].data_value;
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
      saveLocalCache('app_' + filename, val);
    }
  }).catch(function() {});
  return local;
}

async function deleteFile(filename) {
  try {
    const path = CACHE_DIR + ('app_' + filename).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) await FileSystem.deleteAsync(path);
  } catch (e) {}
  apiRequest('DELETE', `/api?table=app_data&filename=${encodeURIComponent(filename)}`).catch(function() {});
}

async function saveUserData(phone, key, data) {
  await saveLocalCache('user_' + phone + '_' + key, data);
  apiRequest('POST', '/api', { _table: 'user_data', phone, data_key: key, data_value: data }).then(function(result) {
    if (result === null) {
      loadLocalCache('pending_sync_' + phone).then(function(pending) {
        pending = pending || [];
        var existing = pending.findIndex(function(p) { return p.key === key; });
        if (existing >= 0) { pending[existing] = { key: key, data: data, timestamp: Date.now() }; }
        else { pending.push({ key: key, data: data, timestamp: Date.now() }); }
        saveLocalCache('pending_sync_' + phone, pending);
      });
    } else {
      loadLocalCache('pending_sync_' + phone).then(function(pending) {
        if (pending && pending.length > 0) {
          var cleaned = pending.filter(function(p) { return p.key !== key; });
          saveLocalCache('pending_sync_' + phone, cleaned);
        }
      });
    }
  }).catch(function() {});
  return { ok: true };
}

async function syncPendingChanges(phone) {
  const pending = await loadLocalCache('pending_sync_' + phone) || [];
  if (pending.length === 0) return;
  const remaining = [];
  for (var i = 0; i < pending.length; i++) {
    var op = pending[i];
    var result = await apiRequest('POST', '/api', { _table: 'user_data', phone: phone, data_key: op.key, data_value: op.data });
    if (result === null) { remaining.push(op); }
  }
  await saveLocalCache('pending_sync_' + phone, remaining);
}

async function loadUserData(phone, key) {
  const local = await loadLocalCache('user_' + phone + '_' + key);
  apiRequest('GET', `/api?table=user_data&phone=${encodeURIComponent(phone)}&key=${encodeURIComponent(key)}`).then(function(result) {
    if (Array.isArray(result) && result.length > 0) {
      var val = result[0].data_value;
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
      saveLocalCache('user_' + phone + '_' + key, val);
    }
  }).catch(function() {});
  return local;
}

async function loadAllUserKeys(phone) {
  const localKeys = ['subscribers', 'generators', 'currentGeneratorId', 'amperPrices', 'goldenPrices', 'monthlyExpenses', 'workerExpenses', 'generatorName', 'ownerName', 'workers', 'deletedWorkers', 'pending_worker_updates', 'worker_activity_log', 'darkMode', 'deletedGenerators'];
  const map = {};
  for (var i = 0; i < localKeys.length; i++) {
    var cached = await loadLocalCache('user_' + phone + '_' + localKeys[i]);
    if (cached !== null && cached !== undefined) { map[localKeys[i]] = cached; }
  }
  apiRequest('GET', `/api?table=user_data&phone=${encodeURIComponent(phone)}`).then(function(result) {
    if (Array.isArray(result) && result.length > 0) {
      for (var j = 0; j < result.length; j++) {
        var row = result[j];
        var val = row.data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
        map[row.data_key] = val;
        saveLocalCache('user_' + phone + '_' + row.data_key, val);
      }
    }
  }).catch(function() {});
  return map;
}

const CACHE_DIR = (FileSystem.documentDirectory || FileSystem.cacheDirectory || '') + 'cache/';

async function ensureCacheDir() {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
  } catch (e) {}
}

async function saveLocalCache(filename, data) {
  try {
    await ensureCacheDir();
    const path = CACHE_DIR + filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
  } catch (e) {}
}

async function loadLocalCache(filename) {
  try {
    const path = CACHE_DIR + filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getAmperForMonth(subscriber, month, year) {
  if (!subscriber.amperHistory || subscriber.amperHistory.length === 0) {
    return subscriber.amper;
  }
  const targetMonth = parseInt(month);
  const targetYear = parseInt(year);
  let result = subscriber.amper;
  for (const entry of subscriber.amperHistory) {
    const eMonth = parseInt(entry.monthKey.split('_')[0]);
    const eYear = parseInt(entry.monthKey.split('_')[1]);
    if (eYear < targetYear || (eYear === targetYear && eMonth <= targetMonth)) {
      result = entry.amper;
    }
  }
  return result;
}

function isDeletedForReport(subscriber, month, year) {
  if (!subscriber.deletedFromMonth) return false;
  const delParts = subscriber.deletedFromMonth.split('_');
  const delMonth = parseInt(delParts[0]);
  const delYear = parseInt(delParts[1]);
  const tMonth = parseInt(month);
  const tYear = parseInt(year);
  if (tYear > delYear) return true;
  if (tYear === delYear && tMonth >= delMonth) return true;
  return false;
}

function getAmperPrice(amperPrices, monthKey) {
  if (amperPrices && amperPrices[monthKey] !== undefined) {
    return parseFloat(amperPrices[monthKey]) || 0;
  }
  return 0;
}

function getGoldenPrice(goldenPrices, monthKey) {
  if (goldenPrices && goldenPrices[monthKey] !== undefined) {
    return parseFloat(goldenPrices[monthKey]) || 0;
  }
  return 0;
}

function getPriceForSubscriber(amperPrices, goldenPrices, monthKey, subscriptionType) {
  if (subscriptionType === 'golden') {
    return getGoldenPrice(goldenPrices, monthKey);
  }
  return getAmperPrice(amperPrices, monthKey);
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const PERMISSION_LABELS = {
  add: 'إضافة مشتركين',
  edit: 'تعديل بيانات',
  delete: 'حذف مشتركين',
  amperPrice: 'تغيير الأمبير',
  cancelPayment: 'إلغاء الدفع',
  partialPayment: 'دفع جزئي',
  addExpense: 'إضافة صرفية',
};

function generateWorkerCode(ownerPhone) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ownerSuffix = ownerPhone.slice(-4);
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(getSecureRandom(chars.length));
  code += ownerSuffix;
  return code;
}

function generateWorkerPin() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pin = '';
  for (let i = 0; i < 8; i++) pin += chars.charAt(getSecureRandom(chars.length));
  return pin;
}

function onlyDigits(text) {
  return text.replace(/[^0-9]/g, '');
}

async function hashPassword(password, salt) {
  const saltedPassword = (salt || 'genBilling') + password.trim();
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    saltedPassword
  );
}

const PBKDF2_ITERATIONS = 10;
async function pbkdf2Hash(password, salt) {
  let hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + ':' + password.trim()
  );
  for (let i = 0; i < PBKDF2_ITERATIONS; i++) {
    hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      hash + ':' + salt + ':' + i
    );
  }
  return 'pbkdf2:' + salt + ':' + hash;
}

function generateSalt() {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function hashWorkerPin(pin) {
  const salt = generateSalt();
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + ':' + pin.trim()
  );
  return 'salted:' + salt + ':' + hash;
}

async function verifyWorkerPin(stored, pin) {
  if (stored && stored.indexOf('salted:') === 0) {
    const parts = stored.split(':');
    const salt = parts[1];
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      salt + ':' + pin.trim()
    );
    return hash === parts[2];
  }
  return stored === pin.trim();
}

async function verifyOwnerPassword(stored, password, phone) {
  if (stored && stored.indexOf('pbkdf2:') === 0) {
    try {
      const parts = stored.split(':');
      const salt = parts[1];
      let hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        salt + ':' + password.trim()
      );
      for (let i = 0; i < PBKDF2_ITERATIONS; i++) {
        hash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          hash + ':' + salt + ':' + i
        );
      }
      if (hash === parts[2]) return { match: true, migrated: false };
    } catch (e) {}
  }
  const saltedHash = await hashPassword(password, phone);
  const unsaltedHash = await hashPassword(password, '');
  if (stored === saltedHash || stored === unsaltedHash) {
    return { match: true, migrated: true };
  }
  if (stored.length !== 64 && stored === password.trim()) {
    return { match: true, migrated: true };
  }
  return { match: false, migrated: false };
}

function getSecureRandom(max) {
  const arr = new Uint8Array(1);
  Crypto.getRandomValues(arr);
  return arr[0] % max;
}

const LoadingOverlay = ({ visible, text }) => {
  if (!visible) return null;
  return (
    <View style={loadingStyles.overlay}>
      <View style={loadingStyles.box}>
        <ActivityIndicator size="large" color="#1565C0" />
        {text ? <Text style={loadingStyles.text}>{text}</Text> : null}
      </View>
    </View>
  );
};

const loadingStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  box: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    gap: 12,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  text: {
    fontSize: 15,
    color: '#333',
    fontWeight: '600',
    textAlign: 'center',
  },
});

function validateName(name) {
  if (!name || name.trim().length < 2) return 'الاسم يجب أن يكون حرفين على الأقل';
  return null;
}

function validateAmper(val) {
  const num = parseInt(val);
  if (!val || isNaN(num) || num < 1 || num > 100) return 'الأمبير يجب أن يكون بين 1 و 100';
  return null;
}

function validatePhone(phone) {
  const clean = onlyDigits(phone);
  if (clean.length !== 11) return 'رقم الهاتف يجب أن يكون 11 رقم';
  if (!clean.startsWith('07')) return 'رقم الهاتف يجب أن يبدأ بـ 07';
  return null;
}

const OnboardingScreen = ({ onComplete }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = [
    {
      icon: 'flash',
      iconColor: '#FFD700',
      title: 'مولدي',
      description: 'تطبيق متكامل لإدارة المشتركين في المولدات الكهربائية وتبسيط عمليات الجباية',
      bg: '#1565C0',
    },
    {
      icon: 'people',
      iconColor: '#4CAF50',
      title: 'إدارة المشتركين',
      description: 'إضافة وتعديل وحذف المشتركين مع تتبع حالة الدفع لكل شهر',
      bg: '#009688',
    },
    {
      icon: 'stats-chart',
      iconColor: '#FF9800',
      title: 'التقارير والإحصائيات',
      description: 'عرض تقارير شاملة للمدفوعات والمطلوبين مع إمكانية البحث والتصفية',
      bg: '#37474F',
    },
    {
      icon: 'person-add',
      iconColor: '#F44336',
      title: 'إدارة العمال',
      description: 'إضافة عامل جديد من الإعدادات عن طريق كود ورمز سري. يمكن تخصيص صلاحياته: إضافة مشتركين، تعديل بيانات، حذف مشتركين، تغيير الأمبير، دفع الأقساط، وإلغاء الدفعات',
      bg: '#4A148C',
    },
    {
      icon: 'card',
      iconColor: '#FFD700',
      title: 'فترة تجربة مجانية',
      description: 'ستحصل على فترة تجربة مجانية لمدة دقيقة واحدة من تاريخ التسجيل. بعد انتهاء الفترة التجريبية، يشترط تفعيل الاشتراك للمتابعة',
      bg: '#1B5E20',
    },
  ];

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <View style={{ flex: 1, backgroundColor: slides[currentSlide].bg }}>
      <StatusBar backgroundColor={slides[currentSlide].bg} barStyle="light-content" />
      <View style={{ flex: 1, justifyContent: 'space-between', padding: IS_SMALL ? 20 : 30, paddingTop: IS_SMALL ? 40 : 60 }}>
        <View style={{ alignItems: 'center', marginTop: IS_SMALL ? 24 : 40 }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: IS_SMALL ? 60 : IS_TABLET ? 90 : 80, width: IS_SMALL ? 120 : IS_TABLET ? 180 : 160, height: IS_SMALL ? 120 : IS_TABLET ? 180 : 160, justifyContent: 'center', alignItems: 'center', marginBottom: IS_SMALL ? 24 : 40 }}>
            <Ionicons name={slides[currentSlide].icon} size={80} color={slides[currentSlide].iconColor} />
          </View>
          <Text style={{ color: 'white', fontSize: IS_SMALL ? 22 : IS_TABLET ? 32 : 26, fontWeight: 'bold', textAlign: 'center', marginBottom: IS_SMALL ? 10 : 16 }}>{slides[currentSlide].title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: IS_SMALL ? 14 : 16, textAlign: 'center', lineHeight: IS_SMALL ? 22 : 28 }}>{slides[currentSlide].description}</Text>
        </View>

        <View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'center', marginBottom: IS_SMALL ? 24 : 40 }}>
            {slides.map((_, index) => (
              <View
                key={index}
                style={{
                  width: currentSlide === index ? (IS_SMALL ? 22 : 28) : 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: currentSlide === index ? 'white' : 'rgba(255,255,255,0.4)',
                  marginHorizontal: 4,
                }}
              />
            ))}
          </View>

          <TouchableOpacity
            style={{ backgroundColor: 'white', borderRadius: IS_SMALL ? 10 : 12, paddingVertical: IS_SMALL ? 12 : 16, alignItems: 'center', marginBottom: IS_SMALL ? 10 : 16 }}
            onPress={handleNext}
          >
            <Text style={{ color: slides[currentSlide].bg, fontSize: IS_SMALL ? 16 : 18, fontWeight: 'bold' }}>
              {currentSlide === slides.length - 1 ? 'ابدأ الآن' : 'التالي'}
            </Text>
          </TouchableOpacity>

          {currentSlide < slides.length - 1 && (
            <TouchableOpacity onPress={handleSkip} style={{ alignItems: 'center', paddingVertical: IS_SMALL ? 8 : 12 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: IS_SMALL ? 14 : 16 }}>تخطي</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const WelcomeScreen = ({ onLogin, onRegister, onWorkerLogin }) => {
  return (
    <View style={styles.welcomeContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
      <View style={styles.welcomeContent}>
        <View style={styles.welcomeLogo}>
          <Ionicons name="flash" size={IS_SMALL ? 60 : IS_TABLET ? 100 : 80} color="#FFD700" />
          <Text style={styles.welcomeTitle}>مولدي</Text>
          <Text style={styles.welcomeSubtitle}>نظام جباية المولدات الأهلية</Text>
        </View>

        <TouchableOpacity style={styles.welcomeLoginBtn} onPress={onLogin}>
          <Text style={styles.welcomeLoginText}>تسجيل الدخول</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.welcomeRegisterBtn} onPress={onRegister}>
          <Text style={styles.welcomeRegisterText}>إنشاء حساب جديد</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.welcomeRegisterBtn, { backgroundColor: '#FF9800', marginTop: IS_SMALL ? 12 : IS_TABLET ? 20 : 15 }]} onPress={onWorkerLogin}>
          <Ionicons name="person-outline" size={IS_SMALL ? 16 : IS_TABLET ? 24 : 20} color="white" style={{ marginLeft: IS_SMALL ? 6 : IS_TABLET ? 10 : 8 }} />
          <Text style={styles.welcomeRegisterText}>دخول العامل</Text>
        </TouchableOpacity>

        <WhatsAppSupportButton />
      </View>
    </View>
  );
};

const RegisterScreen = ({ onBack, onRegister, onRegisterSuccess }) => {
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [confirmOwnerCode, setConfirmOwnerCode] = useState('');
  const [showRegCode, setShowRegCode] = useState(false);
  const [showRegCodeConfirm, setShowRegCodeConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      Alert.alert('تنبيه', 'يجب الاتصال بالإنترنت لإنشاء حساب جديد');
      return;
    }
    const phoneError = validatePhone(phone);
    if (phoneError) {
      Alert.alert('تنبيه', phoneError);
      return;
    }
    if (!ownerName.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال اسم صاحب المولد');
      return;
    }
    if (!/^[a-zA-Z\u0600-\u06FF\s]+$/.test(ownerName.trim())) {
      Alert.alert('تنبيه', 'الاسم يجب أن يحتوي على حروف عربية أو إنجليزية فقط');
      return;
    }
    if (!ownerCode.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال الرمز');
      return;
    }
    if (ownerCode.trim().length < 6) {
      Alert.alert('تنبيه', 'الرمز يجب أن يكون 6 أحرف أو أرقام على الأقل');
      return;
    }
    if (/[\u0600-\u06FF]/.test(ownerCode)) {
      Alert.alert('تنبيه', 'الرمز يجب أن يكون أرقام أو حروف إنجليزية فقط');
      return;
    }
    if (ownerCode.trim() !== confirmOwnerCode.trim()) {
      Alert.alert('تنبيه', 'الرمز غير متطابق');
      return;
    }

    setLoading(true);
    try {
      const hashedPassword = await pbkdf2Hash(ownerCode.trim(), phone.trim());
      const existing = await loadFromFile('registered_users');
      if (existing === null) {
        Alert.alert('خطأ', 'لا يمكن الاتصال بالسيرفر. تحقق من اتصال الإنترنت وحاول مرة أخرى');
        return;
      }
      const users = existing || [];
      if (users.find(u => u.phone === phone.trim())) {
        Alert.alert('تنبيه', 'هذا الرقم مسجل بالفعل. يرجى تسجيل الدخول');
        return;
      }
      users.push({ phone: phone.trim(), password: hashedPassword, ownerCode: ownerCode.trim(), ownerName: ownerName.trim() });
      await saveToFile('registered_users', users);

      await Promise.all([
        saveUserData(phone.trim(), 'generatorName', ''),
        saveUserData(phone.trim(), 'amperPrices', {}),
        saveUserData(phone.trim(), 'subscribers', []),
        saveUserData(phone.trim(), 'monthlyExpenses', {}),
      ]);

      Alert.alert('تم', 'تم إنشاء الحساب بنجاح', [
        { text: 'موافق', onPress: function() { if (onRegisterSuccess) onRegisterSuccess(phone.trim(), ownerName.trim()); else onBack(); } }
      ]);
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء إنشاء الحساب');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.loginContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
      <LoadingOverlay visible={loading} text="جاري إنشاء الحساب..." />
      <ScrollView contentContainerStyle={styles.loginScrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-forward" size={24} color="white" />
        </TouchableOpacity>

        <View style={styles.logoContainer}>
          <Ionicons name="flash" size={50} color="#FFD700" />
          <Text style={styles.appTitle}>إنشاء حساب جديد</Text>
        </View>

        <View style={styles.loginCard}>
          <View style={styles.inputContainer}>
            <Ionicons name="call-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="رقم الهاتف (07xxxxxxxxx)"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={(t) => setPhone(onlyDigits(t))}
              keyboardType="phone-pad"
              maxLength={11}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="اسم صاحب المولد"
              placeholderTextColor="#999"
              value={ownerName}
              onChangeText={setOwnerName}
              maxLength={25}
            />
          </View>

          <View style={styles.inputContainer}>
            <TouchableOpacity onPress={() => setShowRegCode(!showRegCode)}>
              <Ionicons name={showRegCode ? "eye-outline" : "eye-off-outline"} size={22} color="#666" style={styles.inputIcon} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="الرمز (6 أحرف أو أرقام على الأقل)"
              placeholderTextColor="#999"
              value={ownerCode}
              onChangeText={(t) => setOwnerCode(t.replace(/[\u0600-\u06FF]/g, ''))}
              maxLength={20}
              secureTextEntry={!showRegCode}
            />
          </View>

          <View style={styles.inputContainer}>
            <TouchableOpacity onPress={() => setShowRegCodeConfirm(!showRegCodeConfirm)}>
              <Ionicons name={showRegCodeConfirm ? "eye-outline" : "eye-off-outline"} size={22} color="#666" style={styles.inputIcon} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="تأكيد الرمز"
              placeholderTextColor="#999"
              value={confirmOwnerCode}
              onChangeText={(t) => setConfirmOwnerCode(t.replace(/[\u0600-\u06FF]/g, ''))}
              maxLength={20}
              secureTextEntry={!showRegCodeConfirm}
            />
          </View>

          <TouchableOpacity style={styles.loginButton} onPress={handleRegister}>
            <Text style={styles.loginButtonText}>إنشاء الحساب</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onBack}>
            <Text style={styles.linkText}>لديك حساب بالفعل؟ تسجيل الدخول</Text>
          </TouchableOpacity>

          <WhatsAppSupportButton />
        </View>
      </ScrollView>
    </View>
  );
};

const LoginScreen = ({ onBack, onRegister, onLogin, onWorkerLogin }) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const savedAttempts = await SecureStore.getItemAsync('owner_login_attempts');
      const savedLock = await SecureStore.getItemAsync('owner_lock_until');
      if (savedAttempts) setLoginAttempts(parseInt(savedAttempts));
      if (savedLock) {
        const lockTime = parseInt(savedLock);
        if (Date.now() < lockTime) setLockUntil(lockTime);
        else { await SecureStore.deleteItemAsync('owner_lock_until'); await SecureStore.deleteItemAsync('owner_login_attempts'); }
      }
    })();
  }, []);

  const handleLogin = async () => {
    const phoneError = validatePhone(phone);
    if (phoneError) {
      Alert.alert('تنبيه', phoneError);
      return;
    }
    if (!password.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال كلمة المرور');
      return;
    }

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      Alert.alert('تنبيه', 'يجب الاتصال بالإنترنت لتسجيل الدخول');
      return;
    }

    if (lockUntil && Date.now() < lockUntil) {
      const remainingMin = Math.ceil((lockUntil - Date.now()) / 60000);
      Alert.alert('تنبيه', `تم حظر الحساب مؤقتاً. حاول بعد ${remainingMin} دقيقة`);
      return;
    }

    setLoading(true);
    try {
      const usersResult = await loadFromFile('registered_users');
      if (usersResult === null) {
        Alert.alert('خطأ', 'لا يمكن الاتصال بالسيرفر. تحقق من اتصال الإنترنت وحاول مرة أخرى');
        return;
      }
      const usersList = usersResult || [];
      const user = usersList.find(u => u.phone === phone.trim());
      if (!user) {
        Alert.alert('تنبيه', 'الرقم غير مسجل. يرجى إنشاء حساب جديد أولاً');
        return;
      }

      const verifyResult = await verifyOwnerPassword(user.password, password, phone.trim());

      if (verifyResult.migrated) {
        const newHash = await pbkdf2Hash(password.trim(), phone.trim());
        user.password = newHash;
        await saveToFile('registered_users', usersList);
      }

      if (!verifyResult.match) {
        const newAttempts = loginAttempts + 1;
        setLoginAttempts(newAttempts);
        await SecureStore.setItemAsync('owner_login_attempts', String(newAttempts));
        if (newAttempts >= 5) {
          const lockEnd = Date.now() + 15 * 60 * 1000;
          setLockUntil(lockEnd);
          setLoginAttempts(0);
          await SecureStore.setItemAsync('owner_lock_until', String(lockEnd));
          await SecureStore.setItemAsync('owner_login_attempts', '0');
          Alert.alert('تنبيه', 'تم حظر الحساب لمدة 15 دقيقة بسبب محاولات كثيرة');
        } else {
          Alert.alert('تنبيه', `رقم الهاتف أو كلمة المرور غير صحيحة (${newAttempts}/5)`);
        }
        return;
      }

      setLoginAttempts(0);
      setLockUntil(null);
      await SecureStore.deleteItemAsync('owner_login_attempts');
      await SecureStore.deleteItemAsync('owner_lock_until');
      await SecureStore.setItemAsync('current_user', JSON.stringify({ phone: phone.trim(), role: 'owner' }));
      onLogin(phone.trim());
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.loginContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
      <LoadingOverlay visible={loading} text="جاري تسجيل الدخول..." />
      <View style={styles.loginContent}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-forward" size={24} color="white" />
        </TouchableOpacity>

        <View style={styles.logoContainer}>
          <Ionicons name="flash" size={50} color="#FFD700" />
          <Text style={styles.appTitle}>تسجيل الدخول</Text>
        </View>

        <View style={styles.loginCard}>
          <View style={styles.inputContainer}>
            <Ionicons name="call-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="رقم الهاتف (07xxxxxxxxx)"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={(t) => setPhone(onlyDigits(t))}
              keyboardType="phone-pad"
              maxLength={11}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="كلمة المرور"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              maxLength={50}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={22} color="#666" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
            <Text style={styles.loginButtonText}>دخول</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onRegister}>
            <Text style={styles.linkText}>ليس لديك حساب؟ إنشاء حساب جديد</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onWorkerLogin} style={{ marginTop: IS_SMALL ? 10 : IS_TABLET ? 20 : 15 }}>
            <Text style={[styles.linkText, { color: '#FF9800' }]}>دخول العامل</Text>
          </TouchableOpacity>

          <WhatsAppSupportButton />
        </View>
      </View>
    </View>
  );
};

const WorkerLoginScreen = ({ onBack, onLogin, savedWorkerName }) => {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(null);

  useEffect(() => {
    (async () => {
      const savedAttempts = await SecureStore.getItemAsync('worker_login_attempts');
      const savedLock = await SecureStore.getItemAsync('worker_lock_until');
      if (savedAttempts) setLoginAttempts(parseInt(savedAttempts));
      if (savedLock) {
        const lockTime = parseInt(savedLock);
        if (Date.now() < lockTime) setLockUntil(lockTime);
        else { await SecureStore.deleteItemAsync('worker_lock_until'); await SecureStore.deleteItemAsync('worker_login_attempts'); }
      }
    })();
  }, []);

  const handleLogin = async () => {
    if (lockUntil && Date.now() < lockUntil) {
      const remaining = Math.ceil((lockUntil - Date.now()) / 60000);
      Alert.alert('تم الحظر', `تم حظر تسجيل الدخول. يرجى الانتظار ${remaining} دقيقة`);
      return;
    }
    if (!code.trim() || !pin.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال الكود والرمز السري');
      return;
    }
    setLoading(true);
    try {
      const result = await onLogin(code.trim(), pin.trim());
      if (!result) return;
      if (result.ownerExpired) {
        Alert.alert('اشتراك منتهي', 'اشتراك صاحب المولد منتهي. يرجى التواصل مع صاحب المولد لتجديد الاشتراك.');
      } else if (result.deleted) {
        Alert.alert('تنبيه', 'تم حذف الحساب من قبل صاحب المولد');
      } else if (!result.success) {
        const newAttempts = loginAttempts + 1;
        if (newAttempts >= 5) {
          const lockEnd = Date.now() + 15 * 60 * 1000;
          setLockUntil(lockEnd);
          setLoginAttempts(0);
          await SecureStore.setItemAsync('worker_lock_until', String(lockEnd));
          await SecureStore.setItemAsync('worker_login_attempts', '0');
          Alert.alert('تم الحظر', 'تم حظر تسجيل الدخول لمدة 15 دقيقة بسبب المحاولات الفاشلة المتكررة');
        } else {
          setLoginAttempts(newAttempts);
          await SecureStore.setItemAsync('worker_login_attempts', String(newAttempts));
          Alert.alert('تنبيه', `الكود أو الرمز السري غير صحيح. متبقي ${5 - newAttempts} محاولة`);
        }
      } else {
        setLoginAttempts(0);
        setLockUntil(null);
        await SecureStore.deleteItemAsync('worker_login_attempts');
        await SecureStore.deleteItemAsync('worker_lock_until');
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.loginContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
      <LoadingOverlay visible={loading} text="جاري تسجيل الدخول بصفة عامل..." />
      <View style={styles.loginContent}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-forward" size={24} color="white" />
        </TouchableOpacity>

        <View style={styles.logoContainer}>
          <Ionicons name="person" size={50} color="#FFD700" />
          <Text style={styles.appTitle}>دخول العامل</Text>
        </View>

        <View style={styles.loginCard}>
          <View style={styles.inputContainer}>
            <Ionicons name="key-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="كود العامل"
              placeholderTextColor="#999"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={8}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="الرمز السري"
              placeholderTextColor="#999"
              value={pin}
              onChangeText={(t) => setPin(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={8}
            />
          </View>

          <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
            <Text style={styles.loginButtonText}>دخول</Text>
          </TouchableOpacity>

          <WhatsAppSupportButton />
        </View>
      </View>
    </View>
  );
};

const SettingsScreen = ({ visible, onClose, generatorName, onSaveGeneratorName, ownerName, onSaveOwnerName, onCreateWorker, pendingWorkerUpdates, onLoadUpdates, workers, onUpdateWorker, onDeleteWorker, onShowUpdates, onLogout, darkMode, onToggleDarkMode, newWorkerCredentials, onDismissCredentials, generators, onDeleteGenerator, onRestoreGenerator, deletedGenerators, currentGeneratorId, onChangePassword, currentUser, onChangePassVisible, subscribers, amperPrices, goldenPrices }) => {
  const { showNotification } = useNotification();
  const [name, setName] = useState(generatorName);
  const [owner, setOwner] = useState(ownerName);

  const [deleteGenPassword, setDeleteGenPassword] = useState('');
  const [selectedDeleteGenId, setSelectedDeleteGenId] = useState(null);
  const [deleteGeneratorVisible, setDeleteGeneratorVisible] = useState(false);
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  const exportToExcel = async () => {
    setExportingExcel(true);
    try {
      const now = new Date();
      const selMonth = String(now.getMonth() + 1);
      const selYear = String(now.getFullYear());
      const data = subscribers.map(sub => {
        const mk = `${selMonth}_${selYear}`;
        const currentAmper = getAmperForMonth(sub, parseInt(selMonth), parseInt(selYear));
        const price = getPriceForSubscriber(amperPrices, goldenPrices, mk, sub.subscriptionType);
        const paid = sub.paidMonths && sub.paidMonths[mk];
        const pp = sub.partialPayments && sub.partialPayments[mk];
        const totalPaid = pp ? pp.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) : 0;
        return {
          'اسم المشترك': sub.name,
          'الأمبير': currentAmper,
          'سعر الأمبير': price,
          'المبلغ الكلي': currentAmper * price,
          'الواصل': paid ? currentAmper * price : totalPaid,
          'المتبقي': paid ? 0 : (currentAmper * price - totalPaid),
          'الحالة': paid ? 'مدفوع' : (totalPaid > 0 ? 'جزئي' : 'غير مدفوع'),
          'رقم المشترك': sub.subscriberNumber || '',
          'رقم الجوزة': sub.meterNumber || '',
          'رقم الفيز': sub.visaNumber || '',
          'نوع الاشتراك': sub.subscriptionType === 'golden' ? 'ذهبي' : 'عادي',
        };
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'المشتركين');
      const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const filename = `subscribers_${selMonth}_${selYear}.xlsx`;
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, wbout, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'تصدير بيانات المشتركين' });
    } catch (e) {
      showNotification('error', 'خطأ', 'حدث خطأ أثناء التصدير');
    } finally {
      setExportingExcel(false);
    }
  };

  useEffect(() => {
    setName(generatorName);
    setOwner(ownerName);
  }, [generatorName, ownerName, visible]);

  const handleSaveName = (val) => {
    setName(val);
  };

  const handleSaveOwner = (val) => {
    setOwner(val);
  };


  return (<>
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={() => { if (!owner || !owner.trim()) { showNotification('warning', 'تنبيه', 'يجب إدخال اسم صاحب المولد'); return; } onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }}>
      <View style={{ flex: 1, backgroundColor: darkMode ? '#121212' : 'white' }}>
          <View style={[styles.modalHeader, { backgroundColor: '#1565C0' }]}>
            <TouchableOpacity onPress={() => { if (!owner || !owner.trim()) { showNotification('warning', 'تنبيه', 'يجب إدخال اسم صاحب المولد'); return; } onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }} style={[styles.backButton, { width: IS_SMALL ? 36 : 40, height: IS_SMALL ? 36 : 40, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="arrow-forward" size={IS_SMALL ? 24 : 28} color="white" />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: 'white' }]}>الإعدادات</Text>
            <TouchableOpacity onPress={() => { if (!owner || !owner.trim()) { showNotification('warning', 'تنبيه', 'يجب إدخال اسم صاحب المولد'); return; } onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }} style={{ marginRight: 10 }}>
              <Text style={[styles.saveButtonText, { color: 'white' }]}>تم</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.settingsBody}>
              <Text style={[styles.settingsLabel, darkMode && { color: '#fff' }]}>اسم المولد</Text>
              <TextInput
                style={styles.settingsInput}
                value={name}
                onChangeText={handleSaveName}
                placeholder="أدخل اسم المولد"
                placeholderTextColor="#999"
                textAlign="right"
              />
              <Text style={[styles.settingsHint, darkMode && { color: '#888' }]}>سيتم عرض هذا الاسم في مكان عنوان التطبيق</Text>

              <View style={[styles.settingsDivider, darkMode && { backgroundColor: '#333' }]} />

              <Text style={[styles.settingsLabel, darkMode && { color: '#fff' }]}>اسم صاحب المولد</Text>
              <TextInput
                style={styles.settingsInput}
                value={owner}
                onChangeText={handleSaveOwner}
                placeholder="أدخل اسم صاحب المولد"
                placeholderTextColor="#999"
                textAlign="right"
              />
              <Text style={[styles.settingsHint, darkMode && { color: '#888' }]}>سيتم عرض هذا الاسم عند كل عملية دفع أو إلغاء دفع</Text>

              <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#25D366', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginTop: IS_SMALL ? 8 : 12 }]} onPress={() => Linking.openURL('https://wa.me/9647802524458')}>
                <Ionicons name="logo-whatsapp" size={IS_SMALL ? 18 : 20} color="white" />
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>تواصل مع الدعم</Text>
              </TouchableOpacity>

              <View style={[styles.settingsDivider, darkMode && { backgroundColor: '#333' }]} />

              <View style={{ marginTop: IS_SMALL ? 14 : 20, marginBottom: IS_SMALL ? 8 : 10 }}>
                <View style={{ height: 1, backgroundColor: '#ddd', marginBottom: IS_SMALL ? 10 : 16 }} />

                <TouchableOpacity
                  style={[styles.settingsInput, { backgroundColor: '#9C27B0', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginBottom: IS_SMALL ? 8 : 12 }]}
                  onPress={() => onChangePassVisible && onChangePassVisible()}
                >
                  <Ionicons name="key-outline" size={IS_SMALL ? 18 : 20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>تغيير رمز الحساب</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: IS_SMALL ? 8 : 12, paddingHorizontal: IS_SMALL ? 10 : 14, backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: IS_SMALL ? 8 : 10, marginBottom: IS_SMALL ? 8 : 12 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 10 }}>
                    <Ionicons name={darkMode ? 'moon' : 'sunny'} size={IS_SMALL ? 20 : 22} color={darkMode ? '#FFD700' : '#FF9800'} />
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '600', color: darkMode ? '#fff' : '#333' }}>الوضع الليلي</Text>
                  </View>
                  <TouchableOpacity
                    style={{ width: IS_SMALL ? 44 : 50, height: IS_SMALL ? 24 : 28, borderRadius: IS_SMALL ? 12 : 14, backgroundColor: darkMode ? '#4CAF50' : '#ccc', justifyContent: 'center', paddingHorizontal: 3 }}
                    onPress={onToggleDarkMode}
                  >
                    <View style={{ width: IS_SMALL ? 18 : 22, height: IS_SMALL ? 18 : 22, borderRadius: IS_SMALL ? 9 : 11, backgroundColor: 'white', alignSelf: darkMode ? 'flex-end' : 'flex-start' }} />
                  </TouchableOpacity>
                </View>
                <View style={{ height: 1, backgroundColor: '#ddd', marginVertical: IS_SMALL ? 8 : 12 }} />

                <Text style={[styles.settingsLabel, darkMode && { color: '#fff' }]}>سياسة الخصوصية والشروط</Text>

                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#607D8B', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginBottom: IS_SMALL ? 5 : 8 }]} onPress={() => Linking.openURL('https://sites.google.com/view/mowledy-app/privacy-policy')}>
                  <Ionicons name="shield-checkmark-outline" size={IS_SMALL ? 18 : 20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>سياسة الخصوصية</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#607D8B', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginBottom: IS_SMALL ? 5 : 8 }]} onPress={() => Linking.openURL('https://sites.google.com/view/mowledy-app/terms-of-service')}>
                  <Ionicons name="document-text-outline" size={IS_SMALL ? 18 : 20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>شروط الخدمة</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#D32F2F', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginBottom: IS_SMALL ? 8 : 12 }]} onPress={() => { Linking.openURL('https://sites.google.com/view/mowledy-app/privacy-policy'); }}>
                  <Ionicons name="trash-outline" size={IS_SMALL ? 18 : 20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>حذف الحساب والبيانات</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#F44336', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6 }]} onPress={() => { Alert.alert('تسجيل الخروج', 'هل أنت متأكد أنك تريد تسجيل الخروج؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'نعم', style: 'destructive', onPress: onLogout }]); }}>
                  <Ionicons name="log-out-outline" size={IS_SMALL ? 18 : 20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>تسجيل الخروج</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
      </View>
    </Modal>

    <Modal visible={!!newWorkerCredentials} transparent animationType="fade">
      <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 18 : 24, width: MODAL_WIDTH, alignItems: 'center' }}>
          <View style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 30 : 40, width: IS_SMALL ? 56 : 70, height: IS_SMALL ? 56 : 70, alignItems: 'center', justifyContent: 'center', marginBottom: IS_SMALL ? 12 : 16 }}>
            <Ionicons name="checkmark-circle" size={IS_SMALL ? 32 : 40} color="white" />
          </View>
          <Text style={{ fontSize: IS_SMALL ? 17 : 20, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', marginBottom: IS_SMALL ? 12 : 16 }}>تم إنشاء حساب العامل بنجاح</Text>

          <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 14, paddingHorizontal: IS_SMALL ? 20 : 28, width: '100%', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: IS_SMALL ? 6 : 8 }} onPress={async () => {
            const text = 'كود العامل: ' + (newWorkerCredentials ? newWorkerCredentials.code : '') + '\nالرمز السري: ' + (newWorkerCredentials ? newWorkerCredentials.pin : '');
            await Clipboard.setStringAsync(text);
            showNotification('success', 'تم النسخ', 'تم نسخ كود العامل والرمز السري');
          }}>
            <Ionicons name="copy" size={IS_SMALL ? 18 : 20} color="white" />
            <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>نسخ الكود والرمز</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ backgroundColor: '#2196F3', borderRadius: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 14, paddingHorizontal: IS_SMALL ? 28 : 40, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 8 : 10 }} onPress={onDismissCredentials}>
            <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>حسناً</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

      <Modal visible={deleteGeneratorVisible} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 18 : 24, width: MODAL_WIDTH, maxHeight: '70%' }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 10 : 16 }}>
              <Text style={{ fontSize: IS_SMALL ? 15 : 18, fontWeight: 'bold', color: '#F44336' }}>حذف مولد</Text>
              <TouchableOpacity onPress={() => { setDeleteGeneratorVisible(false); setDeleteGenPassword(''); setSelectedDeleteGenId(null); }}>
                <Ionicons name="close" size={IS_SMALL ? 24 : 28} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: IS_SMALL ? 8 : 12 }}>اختر المولد المراد حذفه:</Text>
            {generators.map(function(gen) {
              return (
                <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: IS_SMALL ? 10 : 14, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: selectedDeleteGenId === gen.id ? (darkMode ? '#3a1a1a' : '#FFEBEE') : 'transparent', borderRadius: selectedDeleteGenId === gen.id ? 8 : 0 }} onPress={function() { setSelectedDeleteGenId(gen.id); }}>
                  <Ionicons name={selectedDeleteGenId === gen.id ? 'radio-button-on' : 'radio-button-off'} size={IS_SMALL ? 20 : 22} color={selectedDeleteGenId === gen.id ? '#F44336' : '#999'} style={{ marginLeft: IS_SMALL ? 8 : 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: darkMode ? '#fff' : '#333' }}>{gen.name}</Text>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#999', marginTop: 2 }}>{(gen.subscribers || []).length} مشترك</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ marginTop: IS_SMALL ? 12 : 16 }}>
              <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: IS_SMALL ? 6 : 8 }}>أدخل كلمة المرور للتأكيد:</Text>
              <TextInput style={[styles.settingsInput, { textAlign: 'center', textAlignVertical: 'center' }]} placeholder="كلمة المرور" placeholderTextColor="#999" value={deleteGenPassword} onChangeText={setDeleteGenPassword} secureTextEntry />
            </View>
            <TouchableOpacity style={{ backgroundColor: '#F44336', borderRadius: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 12 : 16, opacity: selectedDeleteGenId && deleteGenPassword ? 1 : 0.5 }} disabled={!selectedDeleteGenId || !deleteGenPassword} onPress={async function() {
              if (!selectedDeleteGenId || !deleteGenPassword) return;
              const success = await onDeleteGenerator(selectedDeleteGenId, deleteGenPassword);
              if (success === false) {
                showNotification('error', 'خطأ', 'كلمة المرور غير صحيحة');
              } else {
                setDeleteGeneratorVisible(false);
                setDeleteGenPassword('');
                setSelectedDeleteGenId(null);
                showNotification('success', 'تم', 'تم حذف المولد بنجاح. يمكنك استرداده من قائمة الاسترداد.');
              }
            }}>
              <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>حذف المولد</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={deleteAccountVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 18 : 24, width: MODAL_WIDTH }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 10 : 16 }}>
              <Text style={{ fontSize: IS_SMALL ? 15 : 18, fontWeight: 'bold', color: '#D32F2F' }}>حذف الحساب</Text>
              <TouchableOpacity onPress={() => { setDeleteAccountVisible(false); setDeleteAccountPassword(''); }}>
                <Ionicons name="close" size={IS_SMALL ? 24 : 28} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: IS_SMALL ? 10 : 16 }}>أدخل رمز الحساب للتأكيد قبل الحذف</Text>
            <TextInput
              style={[styles.settingsInput, { textAlign: 'center' }]}
              placeholder="رمز الحساب"
              placeholderTextColor="#999"
              value={deleteAccountPassword}
              onChangeText={setDeleteAccountPassword}
              secureTextEntry
              maxLength={50}
            />
            <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 8 : 12, marginTop: IS_SMALL ? 12 : 16 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#D32F2F', borderRadius: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 14, alignItems: 'center' }}
                onPress={async () => {
                  if (!deleteAccountPassword.trim()) {
                    showNotification('warning', 'تنبيه', 'أدخل رمز الحساب');
                    return;
                  }
                  try {
                    const usersResult = await loadFromFile('registered_users');
                    const usersList = usersResult || [];
                    const user = usersList.find(function(u) { return u.phone === currentUser; });
                    if (!user) { showNotification('error', 'خطأ', 'حدث خطأ'); return; }
                    const verifyResult = await verifyOwnerPassword(user.password, deleteAccountPassword.trim(), currentUser);
                    if (verifyResult.match) {
                      setDeleteAccountVisible(false);
                      setDeleteAccountPassword('');
                      Linking.openURL('https://sites.google.com/view/mowledy-app/delete-account-data-request');
                    } else {
                      showNotification('error', 'خطأ', 'الرمز غير صحيح');
                    }
                  } catch (e) {
                    showNotification('error', 'خطأ', 'حدث خطأ أثناء التحقق');
                  }
                }}
              >
                <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>تأكيد الحذف</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#eee', borderRadius: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 14, alignItems: 'center' }}
                onPress={() => { setDeleteAccountVisible(false); setDeleteAccountPassword(''); }}
              >
                <Text style={{ color: '#666', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
  </>);
};

const WorkerUpdatesModal = ({ visible, onClose, batches, onApplyBatch, onDeleteBatch, amperPrices, rejectedBatches }) => {
  const { showNotification } = useNotification();
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showRejected, setShowRejected] = useState(false);

  if (!visible) return null;

  const safeBatches = Array.isArray(batches) ? batches : [];
  const safeRejected = Array.isArray(rejectedBatches) ? rejectedBatches : [];

  if (selectedBatch) {
    const updates = Array.isArray(selectedBatch.updates) ? selectedBatch.updates : [];
    const paidUpdates = updates.filter(function(u) { return u && u.type === 'paid'; });
    const cancelledUpdates = updates.filter(function(u) { return u && u.type === 'cancelled'; });
    const deletedUpdates = updates.filter(function(u) { return u && u.type === 'delete'; });
    const partialUpdates = updates.filter(function(u) { return u && u.type === 'partialPayment'; });
    const addUpdates = updates.filter(function(u) { return u && u.type === 'add'; });
    const editUpdates = updates.filter(function(u) { return u && (u.type === 'edit' || u.type === 'restore'); });
    let paidTotal = 0;
    for (let i = 0; i < paidUpdates.length; i++) { paidTotal += (paidUpdates[i].details && paidUpdates[i].details.amount) ? parseFloat(paidUpdates[i].details.amount) : 0; }
    let partialTotal = 0;
    for (let j = 0; j < partialUpdates.length; j++) { partialTotal += (partialUpdates[j].details && partialUpdates[j].details.amount) ? parseFloat(partialUpdates[j].details.amount) : 0; }

    return (
      <Modal visible={visible} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.modalContent, { borderRadius: 20, maxHeight: '85%', width: MODAL_WIDTH, flex: 1 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={function() { setSelectedBatch(null); }}>
                <Ionicons name="arrow-forward" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>تحديثات #{selectedBatch.number || ''}</Text>
              <View style={{ width: 28 }} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ padding: 15 }}>
                <View style={{ backgroundColor: '#1565C0', borderRadius: 16, padding: 18, marginBottom: 15, borderWidth: 1, borderColor: '#0D47A1' }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 8 }}>
                    <Ionicons name="cash" size={24} color="white" />
                    <Text style={{ fontSize: 17, fontWeight: 'bold', color: 'white', marginRight: 8 }}>المجموع الكلي</Text>
                  </View>
                  <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#FFD54F', textAlign: 'center', marginVertical: 6 }}>{formatNumber(paidTotal + partialTotal)} د.ع</Text>
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-around', marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.3)', paddingTop: 10 }}>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>المدفوع</Text>
                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#A5D6A7' }}>{formatNumber(paidTotal)} د.ع</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>الدفع الجزئي</Text>
                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#FFE082' }}>{formatNumber(partialTotal)} د.ع</Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>العدد</Text>
                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: 'white' }}>{updates.length}</Text>
                    </View>
                  </View>
                </View>
                {updates.map(function(u, idx) {
                  if (!u) return null;
                  let typeLabel = '';
                  let typeColor = '#333';
                  let bgColor = '#f8f8f8';
                  let borderColor = '#eee';
                  let iconName = 'document-text';
                  let iconColor = '#999';
                  let detailText = '';
                  if (u.type === 'paid') {
                    typeLabel = 'دفع اشتراك';
                    typeColor = '#2E7D32';
                    bgColor = '#E8F5E9';
                    borderColor = '#4CAF50';
                    iconName = 'checkmark-circle';
                    iconColor = '#4CAF50';
                    detailText = 'المبلغ: ' + formatNumber((u.details && u.details.amount) ? parseFloat(u.details.amount) : 0) + ' د.ع';
                  } else if (u.type === 'partialPayment') {
                    typeLabel = 'دفع جزئي';
                    typeColor = '#E65100';
                    bgColor = '#FFF3E0';
                    borderColor = '#FF9800';
                    iconName = 'wallet';
                    iconColor = '#FF9800';
                    detailText = 'المبلغ الواصل: ' + formatNumber((u.details && u.details.amount) ? parseFloat(u.details.amount) : 0) + ' د.ع';
                  } else if (u.type === 'cancelled') {
                    typeLabel = 'الغاء الدفع';
                    typeColor = '#C62828';
                    bgColor = '#FFEBEE';
                    borderColor = '#FF5722';
                    iconName = 'close-circle';
                    iconColor = '#FF5722';
                    detailText = 'تم الغاء الدفع لهذا الشهر';
                  } else if (u.type === 'delete') {
                    typeLabel = 'حذف';
                    typeColor = '#BF360C';
                    bgColor = '#FBE9E7';
                    borderColor = '#D84315';
                    iconName = 'trash';
                    iconColor = '#D84315';
                    detailText = 'تم حذف المشترك';
                  } else if (u.type === 'add') {
                    typeLabel = 'اضافة مشترك';
                    typeColor = '#2E7D32';
                    bgColor = '#E8F5E9';
                    borderColor = '#2E7D32';
                    iconName = 'person-add';
                    iconColor = '#2E7D32';
                    detailText = 'مشترك جديد - ' + (u.amper || '') + ' امبير';
                  } else if (u.type === 'edit') {
                    typeLabel = 'تعديل';
                    typeColor = '#1565C0';
                    bgColor = '#E3F2FD';
                    borderColor = '#1565C0';
                    iconName = 'create';
                    iconColor = '#1565C0';
                    detailText = 'تم تعديل بيانات المشترك';
                  } else if (u.type === 'restore') {
                    typeLabel = 'استعادة';
                    typeColor = '#1565C0';
                    bgColor = '#E3F2FD';
                    borderColor = '#1565C0';
                    iconName = 'refresh';
                    iconColor = '#1565C0';
                    detailText = 'تم استعادة المشترك';
                  }
                  let monthLabel = u.monthKey || '';
                  if (monthLabel && monthLabel.indexOf('_') !== -1) {
                    const parts = monthLabel.split('_');
                    monthLabel = 'الشهر ' + parts[0] + '/' + parts[1];
                  }
                  return (
                    <View key={u.id || ('u' + idx)} style={{ backgroundColor: bgColor, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: borderColor }}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', flex: 1 }}>
                          <Ionicons name={iconName} size={18} color={iconColor} />
                          <Text style={{ fontSize: 14, fontWeight: 'bold', color: typeColor, marginRight: 6 }}>{typeLabel}</Text>
                        </View>
                        {monthLabel ? <Text style={{ fontSize: 12, color: '#888' }}>{monthLabel}</Text> : null}
                      </View>
                      <Text style={{ fontSize: 13, color: '#333', fontWeight: '600', marginTop: 6, textAlign: 'right' }}>{u.subscriberName || ''}</Text>
                      {detailText ? <Text style={{ fontSize: 12, color: '#666', marginTop: 3, textAlign: 'right' }}>{detailText}</Text> : null}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#4CAF50', marginTop: 10, marginHorizontal: 15, marginBottom: 15 }]} onPress={function() { onApplyBatch(selectedBatch.id); setSelectedBatch(null); }}>
              <Ionicons name="checkmark-done" size={20} color="white" />
              <Text style={styles.modalButtonText}>تطبيق التغييرات</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
        <View style={[styles.modalContent, { borderRadius: 20, maxHeight: '85%', width: MODAL_WIDTH, flex: 1 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>تحديثات العامل</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ padding: 15 }}>
              {safeBatches.length === 0 ? (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Ionicons name="checkmark-done-circle-outline" size={60} color="#ccc" />
                  <Text style={{ textAlign: 'center', color: '#999', fontSize: 16, marginTop: 10 }}>لا يوجد تحديثات</Text>
                </View>
              ) : safeBatches.map(function(batch) {
                  let updates = Array.isArray(batch.updates) ? batch.updates : [];
                  let paidCount = 0, paidTotal = 0, partialCount = 0, partialTotal = 0, cancelledCount = 0, deletedCount = 0, addCount = 0, editCount = 0;
                  for (let k = 0; k < updates.length; k++) {
                    const u = updates[k];
                    if (!u) continue;
                    if (u.type === 'paid') { paidCount++; paidTotal += (u.details && u.details.amount) ? parseFloat(u.details.amount) : 0; }
                    else if (u.type === 'partialPayment') { partialCount++; partialTotal += (u.details && u.details.amount) ? parseFloat(u.details.amount) : 0; }
                    else if (u.type === 'cancelled') { cancelledCount++; }
                    else if (u.type === 'delete') { deletedCount++; }
                    else if (u.type === 'add') { addCount++; }
                    else if (u.type === 'edit' || u.type === 'restore') { editCount++; }
                  }
                  return (
                    <TouchableOpacity key={batch.id || 'b'} style={{ backgroundColor: '#f8f8f8', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: '#eee', elevation: 2 }} onPress={function() { setSelectedBatch(batch); }}>
                      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center' }}>
                          <View style={{ backgroundColor: '#2196F3', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 }}>
                            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{'#' + (batch.number || '')}</Text>
                          </View>
                          <Text style={{ fontSize: 14, color: '#666' }}>{batch.workerName || ''}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: '#999' }}>{batch.timestamp || ''}</Text>
                      </View>
                      {paidCount > 0 && (
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                          <Text style={{ fontSize: 13, color: '#2E7D32', fontWeight: '600', marginRight: 6 }}>تم الدفع ({paidCount}) بمبلغ ({formatNumber(paidTotal)} د.ع)</Text>
                        </View>
                      )}
                      {partialCount > 0 && (
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="wallet" size={16} color="#FF9800" />
                          <Text style={{ fontSize: 13, color: '#E65100', fontWeight: '600', marginRight: 6 }}>دفع جزئي ({partialCount}) بمبلغ ({formatNumber(partialTotal)} د.ع)</Text>
                        </View>
                      )}
                      {cancelledCount > 0 && (
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="close-circle" size={16} color="#FF5722" />
                          <Text style={{ fontSize: 13, color: '#C62828', fontWeight: '600', marginRight: 6 }}>تم الغاء الدفع ({cancelledCount})</Text>
                        </View>
                      )}
                      {deletedCount > 0 && (
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="trash" size={16} color="#D84315" />
                          <Text style={{ fontSize: 13, color: '#BF360C', fontWeight: '600', marginRight: 6 }}>تم الحذف ({deletedCount})</Text>
                        </View>
                      )}
                      {addCount > 0 && (
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="person-add" size={16} color="#2E7D32" />
                          <Text style={{ fontSize: 13, color: '#2E7D32', fontWeight: '600', marginRight: 6 }}>اضافة ({addCount})</Text>
                        </View>
                      )}
                      {editCount > 0 && (
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="create" size={16} color="#1565C0" />
                          <Text style={{ fontSize: 13, color: '#1565C0', fontWeight: '600', marginRight: 6 }}>تعديل ({editCount})</Text>
                        </View>
                      )}
                      <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10, marginTop: 4, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, color: '#666' }}>عدد التحديثات: {updates.length}</Text>
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                          <TouchableOpacity onPress={function() {
                            Alert.alert('حذف التحديث', 'هل تريد حذف هذا التحديث؟', [
                              { text: 'إلغاء', style: 'cancel' },
                              { text: 'حذف', style: 'destructive', onPress: function() { onDeleteBatch(batch.id); } },
                            ]);
                          }} style={{ backgroundColor: '#FFEBEE', borderRadius: 8, padding: 6 }}>
                            <Ionicons name="trash-outline" size={18} color="#F44336" />
                          </TouchableOpacity>
                          <Ionicons name="chevron-back" size={20} color="#999" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              }

              {safeRejected.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 10 }} onPress={() => setShowRejected(!showRejected)}>
                    <Ionicons name={showRejected ? "chevron-down" : "chevron-back"} size={20} color="#F44336" />
                    <Text style={{ fontSize: 15, color: '#F44336', fontWeight: 'bold', marginRight: 6 }}>المرفوضات ({safeRejected.length})</Text>
                  </TouchableOpacity>
                  {showRejected && safeRejected.map(function(batch) {
                    let updates = Array.isArray(batch.updates) ? batch.updates : [];
                    return (
                      <View key={batch.id || 'r'} style={{ backgroundColor: '#FFF3E0', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#FFCC80' }}>
                        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center' }}>
                            <View style={{ backgroundColor: '#F44336', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>مرفوض</Text>
                            </View>
                            <Text style={{ fontSize: 13, color: '#666' }}>{batch.workerName || ''}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: '#999' }}>{batch.timestamp || ''}</Text>
                        </View>
                        {updates.map(function(update, idx) {
                          const typeLabels = { paid: 'دفع', cancelled: 'إلغاء دفع', add: 'إضافة مشترك', edit: 'تعديل', delete: 'حذف', restore: 'استعادة', addExpense: 'صرفية', partialPayment: 'دفع جزئي' };
                          const typeColors = { paid: '#4CAF50', cancelled: '#FF9800', add: '#2196F3', edit: '#9C27B0', delete: '#F44336', restore: '#00BCD4', addExpense: '#FF5722', partialPayment: '#FF9800' };
                          return (
                            <View key={idx} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                              <View style={{ backgroundColor: typeColors[update.type] || '#999', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>{typeLabels[update.type] || update.type}</Text>
                              </View>
                              <Text style={{ fontSize: 12, color: '#555', flex: 1 }}>{update.subscriberName || ''}</Text>
                            </View>
                          );
                        })}
                        <Text style={{ fontSize: 11, color: '#F44336', marginTop: 6, fontWeight: 'bold' }}>تم الرفض نهائياً - لا يمكن التراجع</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const MonthPickerModal = ({ visible, onClose, onSelect, selectedMonth }) => {
  const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerContent}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>اختر الشهر</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.pickerList}>
            {months.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.pickerItem, selectedMonth === m && styles.pickerItemSelected]}
                onPress={() => { onSelect(m); onClose(); }}
              >
                <Text style={[styles.pickerItemText, selectedMonth === m && styles.pickerItemTextSelected]}>{m}</Text>
                {selectedMonth === m && <Ionicons name="checkmark" size={22} color="#2196F3" />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const YearPickerModal = ({ visible, onClose, onSelect, selectedYear }) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => String(currentYear - 5 + i));

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerContent}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>اختر السنة</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.pickerList}>
            {years.map((y) => (
              <TouchableOpacity
                key={y}
                style={[styles.pickerItem, selectedYear === y && styles.pickerItemSelected]}
                onPress={() => { onSelect(y); onClose(); }}
              >
                <Text style={[styles.pickerItemText, selectedYear === y && styles.pickerItemTextSelected]}>{y}</Text>
                {selectedYear === y && <Ionicons name="checkmark" size={22} color="#2196F3" />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const AddWorkerScreen = ({ visible, onClose, generators, darkMode, currentUser, onConfirmCreate }) => {
  const { showNotification } = useNotification();
  const [workerName, setWorkerName] = useState('');
  const [perms, setPerms] = useState([]);
  const [assignedGens, setAssignedGens] = useState([]);

  useEffect(() => {
    if (!visible) return;
    var sub = BackHandler.addEventListener('hardwareBackPress', function() {
      onClose();
      return true;
    });
    return function() { sub.remove(); };
  }, [visible]);

  if (!visible) return null;

  var togglePerm = function(key) {
    setPerms(function(prev) { return prev.indexOf(key) >= 0 ? prev.filter(function(x) { return x !== key; }) : [...prev, key]; });
  };

  var handleCreate = function() {
    if (!workerName.trim()) { showNotification('warning', 'تنبيه', 'يرجى إدخال اسم العامل'); return; }
    if (perms.length === 0) { showNotification('warning', 'تنبيه', 'اختر صلاحية واحدة على الأقل'); return; }
    if (assignedGens.length === 0) { showNotification('warning', 'تنبيه', 'اختر مولداً واحداً على الأقل'); return; }
    onConfirmCreate(workerName.trim(), perms, assignedGens);
    setWorkerName('');
    setPerms([]);
    setAssignedGens([]);
  };

  return (
    <View style={styles.subscribersOverlay}>
      <View style={styles.subscribersContainer}>
        <View style={styles.subscribersHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-forward" size={26} color="white" />
          </TouchableOpacity>
          <Text style={styles.subscribersTitle}>إضافة عامل جديد</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
          <View style={{ padding: IS_SMALL ? 12 : 16 }}>
            <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#fff' : '#333', marginBottom: IS_SMALL ? 6 : 8, textAlign: 'right', fontWeight: 'bold' }}>اسم العامل <Text style={{ color: '#F44336' }}>*</Text></Text>
            <TextInput style={{ backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, fontSize: IS_SMALL ? 14 : 16, borderWidth: 1, borderColor: darkMode ? '#444' : '#e0e0e0', textAlign: 'right', color: darkMode ? '#fff' : '#333' }} placeholder="أدخل اسم العامل" placeholderTextColor="#999" value={workerName} onChangeText={setWorkerName} />

            <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#aaa' : '#666', marginTop: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 8 : 10, textAlign: 'center' }}>اختر الصلاحيات التي تريدها للعامل:</Text>

            {[
              { key: 'add', label: 'إضافة مشتركين', icon: 'person-add-outline' },
              { key: 'edit', label: 'تعديل بيانات المشتركين', icon: 'create-outline' },
              { key: 'delete', label: 'حذف مشتركين', icon: 'trash-outline' },
              { key: 'amperPrice', label: 'تغيير سعر الأميبر', icon: 'flash-outline' },
              { key: 'cancelPayment', label: 'إلغاء الدفع', icon: 'close-circle-outline' },
              { key: 'partialPayment', label: 'الدفع الجزئي', icon: 'wallet-outline' },
              { key: 'addExpense', label: 'إضافة صرفية', icon: 'receipt-outline' },
            ].map(function(p) {
              var active = perms.indexOf(p.key) >= 0;
              return (
                <TouchableOpacity key={p.key} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 12 : 14, paddingHorizontal: IS_SMALL ? 10 : 14, borderBottomWidth: 1, borderBottomColor: darkMode ? '#333' : '#eee', backgroundColor: active ? (darkMode ? '#1a3a1a' : '#E8F5E9') : 'transparent' }} onPress={function() { togglePerm(p.key); }}>
                  <Ionicons name={active ? 'checkbox' : 'square-outline'} size={IS_SMALL ? 22 : 26} color={active ? '#4CAF50' : '#999'} />
                  <Ionicons name={p.icon} size={IS_SMALL ? 16 : 18} color={active ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: darkMode ? '#fff' : '#333', flex: 1 }}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}

            {generators && generators.length > 0 && (
              <View style={{ marginTop: IS_SMALL ? 14 : 18 }}>
                <Text style={{ fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', marginBottom: IS_SMALL ? 8 : 10, textAlign: 'right' }}>المولدات المسموح بها: <Text style={{ color: '#F44336' }}>*</Text></Text>
                {generators.map(function(gen) {
                  var isSel = assignedGens.indexOf(gen.id) >= 0;
                  return (
                    <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 12, borderBottomWidth: 1, borderBottomColor: darkMode ? '#333' : '#eee', backgroundColor: isSel ? (darkMode ? '#2a1a00' : '#FFF3E0') : 'transparent', borderRadius: isSel ? 8 : 0 }} onPress={function() { setAssignedGens(function(prev) { return isSel ? prev.filter(function(id) { return id !== gen.id; }) : [...prev, gen.id]; }); }}>
                      <Ionicons name={isSel ? 'checkbox' : 'square-outline'} size={IS_SMALL ? 22 : 26} color={isSel ? '#FF9800' : '#999'} />
                      <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: darkMode ? '#fff' : '#333', flex: 1 }}>{gen.name}</Text>
                      <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#999' }}>({(gen.subscribers || []).length} مشترك)</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 16 : 20 }} onPress={handleCreate}>
              <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>إنشاء حساب العامل</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );
};

const EditWorkerScreen = ({ visible, onClose, workers, generators, onUpdateWorker, onDeleteWorker, onResetWorkerPin, darkMode, currentUser }) => {
  const { showNotification } = useNotification();
  const [selWorker, setSelWorker] = useState(null);
  const [editPerms, setEditPerms] = useState([]);
  const [editAssignedGens, setEditAssignedGens] = useState([]);
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', function() {
      if (showPasswordModal) {
        setShowPasswordModal(false);
        setOwnerPassword('');
        return true;
      }
      if (selWorker) {
        setSelWorker(null);
        setEditPerms([]);
        setEditAssignedGens([]);
        return true;
      }
      onClose();
      return true;
    });
    return function() { handler.remove(); };
  }, [visible, selWorker, showPasswordModal]);

  if (!visible) return null;

  return (
    <View style={styles.subscribersOverlay}>
      <View style={styles.subscribersContainer}>
        <View style={styles.subscribersHeader}>
          {selWorker ? (
            <TouchableOpacity onPress={() => { setSelWorker(null); setEditPerms([]); setEditAssignedGens([]); }} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
          )}
          <Text style={styles.subscribersTitle}>{selWorker ? 'تعديل الصلاحيات' : 'تعديل صلاحيات العامل'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
          <View style={{ padding: IS_SMALL ? 12 : 16 }}>
            {selWorker ? (
              <>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 12, marginBottom: IS_SMALL ? 12 : 16, backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 14 }}>
                  <View style={{ backgroundColor: '#FF9800', borderRadius: 20, width: IS_SMALL ? 40 : 44, height: IS_SMALL ? 40 : 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="person" size={IS_SMALL ? 18 : 20} color="white" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: IS_SMALL ? 15 : 17, fontWeight: 'bold', color: darkMode ? '#fff' : '#333' }}>{selWorker.workerName || 'بدون اسم'}</Text>
                  </View>
                </View>

                <Text style={[styles.formLabel, { fontWeight: 'bold', marginBottom: IS_SMALL ? 8 : 10 }]}>اختر الصلاحيات الجديدة:</Text>
                {[
                  { key: 'add', label: 'إضافة مشتركين', icon: 'person-add-outline' },
                  { key: 'edit', label: 'تعديل بيانات المشتركين', icon: 'create-outline' },
                  { key: 'delete', label: 'حذف مشتركين', icon: 'trash-outline' },
                  { key: 'amperPrice', label: 'تغيير سعر الأميبر', icon: 'flash-outline' },
                  { key: 'cancelPayment', label: 'إلغاء الدفع', icon: 'close-circle-outline' },
                  { key: 'partialPayment', label: 'الدفع الجزئي', icon: 'wallet-outline' },
                  { key: 'addExpense', label: 'إضافة صرفية', icon: 'receipt-outline' },
                ].map(function(p) {
                  var active = editPerms.indexOf(p.key) >= 0;
                  return (
                    <TouchableOpacity key={p.key} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 12 : 14, paddingHorizontal: IS_SMALL ? 10 : 14, borderBottomWidth: 1, borderBottomColor: darkMode ? '#333' : '#eee', backgroundColor: active ? (darkMode ? '#1a3a1a' : '#E8F5E9') : 'transparent' }} onPress={function() { setEditPerms(function(prev) { return prev.indexOf(p.key) >= 0 ? prev.filter(function(x) { return x !== p.key; }) : [...prev, p.key]; }); }}>
                    <Ionicons name={active ? 'checkbox' : 'square-outline'} size={IS_SMALL ? 22 : 26} color={active ? '#4CAF50' : '#999'} />
                    <Ionicons name={p.icon} size={IS_SMALL ? 16 : 18} color={active ? '#4CAF50' : '#999'} />
                    <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: darkMode ? '#fff' : '#333', flex: 1 }}>{p.label}</Text>
                  </TouchableOpacity>
                );
                })}

                {generators && generators.length > 1 && (
                  <View style={{ marginTop: IS_SMALL ? 14 : 18 }}>
                    <Text style={[styles.formLabel, { fontWeight: 'bold', marginBottom: IS_SMALL ? 8 : 10 }]}>المولدات المسموح بها:</Text>
                    {generators.map(function(gen) {
                      var isSel = editAssignedGens.indexOf(gen.id) >= 0;
                      return (
                        <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 10 : 12, borderBottomWidth: 1, borderBottomColor: darkMode ? '#333' : '#eee', backgroundColor: isSel ? (darkMode ? '#2a1a00' : '#FFF3E0') : 'transparent', borderRadius: isSel ? 8 : 0 }} onPress={function() { setEditAssignedGens(function(prev) { return isSel ? prev.filter(function(id) { return id !== gen.id; }) : [...prev, gen.id]; }); }}>
                          <Ionicons name={isSel ? 'checkbox' : 'square-outline'} size={IS_SMALL ? 22 : 26} color={isSel ? '#FF9800' : '#999'} />
                          <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: darkMode ? '#fff' : '#333', flex: 1 }}>{gen.name}</Text>
                          <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#999' }}>({(gen.subscribers || []).length} مشترك)</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <TouchableOpacity style={{ backgroundColor: '#2196F3', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 16 : 20 }} onPress={function() { setShowPasswordModal(true); }}>
                  <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>حفظ التعديلات</Text>
                </TouchableOpacity>

                <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 8 : 10, flexDirection: 'row', justifyContent: 'center', gap: IS_SMALL ? 6 : 8 }} onPress={async function() {
                  var text = 'كود العامل: ' + selWorker.code + '\nالرمز السري: ' + (selWorker.plainPin || 'غير متوفر');
                  await Clipboard.setStringAsync(text);
                  showNotification('success', 'تم النسخ', 'تم نسخ كود العامل والرمز السري');
                }}>
                  <Ionicons name="copy-outline" size={IS_SMALL ? 16 : 18} color="white" />
                  <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>نسخ كود ورمز العامل</Text>
                </TouchableOpacity>

                <TouchableOpacity style={{ backgroundColor: '#F44336', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 8 : 10 }} onPress={function() {
                  Alert.alert('حذف العامل', 'هل تريد حذف العامل "' + (selWorker.workerName || selWorker.code) + '" نهائياً؟\nسيتم تسجيل خروج العامل تلقائياً وتعطيل الكود.', [
                    { text: 'إلغاء', style: 'cancel' },
                    { text: 'نعم، حذف', style: 'destructive', onPress: function() {
                      onDeleteWorker(selWorker.code);
                      setSelWorker(null);
                      setEditPerms([]);
                      setEditAssignedGens([]);
                      onClose();
                    } },
                  ]);
                }}>
                  <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>حذف العامل</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {(!workers || workers.length === 0) ? (
                  <View style={{ alignItems: 'center', marginTop: IS_SMALL ? 40 : 60 }}>
                    <Ionicons name="people-outline" size={IS_SMALL ? 50 : 60} color="#ccc" />
                    <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#999', marginTop: IS_SMALL ? 8 : 10 }}>لا يوجد عمال مسجلين</Text>
                  </View>
                ) : (
                  workers.map(function(worker, index) {
                    return (
                      <TouchableOpacity key={index} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 12 : 14, paddingHorizontal: IS_SMALL ? 10 : 14, marginBottom: IS_SMALL ? 6 : 8, borderRadius: IS_SMALL ? 8 : 10, backgroundColor: darkMode ? '#1e1e1e' : 'white', borderWidth: 1, borderColor: darkMode ? '#333' : '#eee' }} onPress={function() {
                        setSelWorker(worker);
                        setEditPerms(worker.permissions || []);
                        setEditAssignedGens(worker.assignedGenerators || []);
                      }}>
                        <View style={{ backgroundColor: '#FF9800', borderRadius: 20, width: IS_SMALL ? 40 : 44, height: IS_SMALL ? 40 : 44, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="person" size={IS_SMALL ? 18 : 20} color="white" />
                        </View>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: IS_SMALL ? 15 : 17, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', textAlign: 'right' }}>{worker.workerName || 'بدون اسم'}</Text>
                          <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#999', marginTop: 2, textAlign: 'right' }}>{(worker.permissions || []).length} صلاحيات</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </>
            )}
          </View>
        </ScrollView>
      </View>

      <Modal visible={showPasswordModal} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 18 : 24, width: MODAL_WIDTH }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 10 : 16 }}>
              <Text style={{ fontSize: IS_SMALL ? 15 : 18, fontWeight: 'bold', color: darkMode ? '#fff' : '#333' }}>تأكيد هوية صاحب المولد</Text>
              <TouchableOpacity onPress={() => { setShowPasswordModal(false); setOwnerPassword(''); }}>
                <Ionicons name="close" size={IS_SMALL ? 24 : 28} color={darkMode ? '#fff' : '#333'} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: IS_SMALL ? 10 : 14 }}>أدخل رمز حساب صاحب المولد للتأكيد</Text>
            <TextInput style={[styles.settingsInput, { textAlign: 'center' }]} placeholder="رمز الحساب" placeholderTextColor="#999" value={ownerPassword} onChangeText={setOwnerPassword} secureTextEntry />
            <TouchableOpacity style={{ backgroundColor: '#2196F3', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 12 : 16, opacity: ownerPassword ? 1 : 0.5 }} disabled={!ownerPassword} onPress={async function() {
              if (!ownerPassword) return;
              const usersResult = await loadFromFile('registered_users');
              const list = usersResult || [];
              var found = false;
              for (var i = 0; i < list.length; i++) {
                if (list[i].phone === currentUser) {
                  const vr = await verifyOwnerPassword(list[i].password, ownerPassword, currentUser);
                  if (vr.match) { found = true; break; }
                }
              }
              if (!found) {
                showNotification('error', 'خطأ', 'رمز الحساب غير صحيح');
                return;
              }
              setShowPasswordModal(false);
              setOwnerPassword('');
              onUpdateWorker(selWorker.code, editPerms, editAssignedGens);
              setSelWorker(null);
              setEditPerms([]);
              setEditAssignedGens([]);
              onClose();
            }}>
              <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>تأكيد</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const WorkerTrackingScreen = ({ visible, onClose, workers, activityLog, amperPrices, pendingWorkerUpdates, onApplyBatch, onDeleteBatch, rejectedBatches, currentUser, fullScreen, onAddWorker, onEditWorker }) => {
  const { showNotification } = useNotification();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showRejected, setShowRejected] = useState(false);
  const [showExpenses, setShowExpenses] = useState(false);
  const [viewedBatches, setViewedBatches] = useState([]);

  const markBatchViewed = async (batchId) => {
    if (viewedBatches.indexOf(batchId) >= 0) return;
    setViewedBatches(function(prev) { return [...prev, batchId]; });
    try {
      const existingLog = await loadUserData(currentUser, 'worker_activity_log') || [];
      const updatedLog = existingLog.map(function(l) { return l.id === batchId ? { ...l, viewed: true } : l; });
      await saveUserData(currentUser, 'worker_activity_log', updatedLog);
    } catch (e) {}
  };

  useEffect(() => {
    if (visible) {
      const viewed = [];
      (pendingWorkerUpdates || []).forEach(function(b) {
        const logEntry = (activityLog || []).find(function(l) { return l.id === b.id; });
        if (logEntry && logEntry.viewed) viewed.push(b.id);
      });
      setViewedBatches(viewed);
    }
  }, [visible, pendingWorkerUpdates, activityLog]);
  const safePending = Array.isArray(pendingWorkerUpdates) ? pendingWorkerUpdates : [];
  const safeRejected = Array.isArray(rejectedBatches) ? rejectedBatches : [];
  const totalPendingCollected = useMemo(() => {
    let total = 0;
    const monthKey = `${selectedMonth}_${selectedYear}`;
    const allBatches = Array.isArray(activityLog) ? activityLog : [];
    allBatches.forEach(function(batch) {
      if (batch.status === 'rejected') return;
      if (selectedWorker) {
        const bCode = batch.workerCode || '';
        const bName = batch.workerName || '';
        if (bCode !== selectedWorker.code && bName !== selectedWorker.workerName) return;
      }
      (batch.updates || []).forEach(function(u) {
        if (u && u.monthKey === monthKey && (u.type === 'paid' || u.type === 'partialPayment') && u.details && u.details.amount) {
          total += parseFloat(u.details.amount);
        }
      });
    });
    return total;
  }, [activityLog, selectedWorker, selectedMonth, selectedYear]);

  useEffect(() => {
    if (visible && workers.length === 1) {
      setSelectedWorker(workers[0]);
    }
  }, [visible, workers]);

  const filteredLogs = useMemo(() => {
    if (!activityLog || !Array.isArray(activityLog)) return [];
    const monthKey = `${selectedMonth}_${selectedYear}`;
    return activityLog.filter(batch => {
      if (selectedWorker) {
        const bCode = batch.workerCode || '';
        const bName = batch.workerName || '';
        if (bCode !== selectedWorker.code && bName !== selectedWorker.workerName) return false;
      }
      return (batch.updates || []).some(u => u.monthKey === monthKey);
    });
  }, [activityLog, selectedMonth, selectedYear, selectedWorker]);

  const { expenses, totalExpenses } = useMemo(() => {
    const monthKey = `${selectedMonth}_${selectedYear}`;
    let exps = [];
    let te = 0;
    filteredLogs.forEach(batch => {
      (batch.updates || []).forEach(u => {
        if (u.monthKey !== monthKey) return;
        if (u.type === 'addExpense') {
          const expType = (u.details && u.details.expenseType) || u.subscriberName || '';
          const amount = (u.details && u.details.amount) || 0;
          exps.push({ type: expType, amount, timestamp: u.timestamp, workerName: batch.workerName || '' });
          te += amount;
        }
      });
    });
    return { expenses: exps, totalExpenses: te };
  }, [filteredLogs, selectedMonth, selectedYear]);

  if (!visible && !fullScreen) return null;

  const trackingModalContent = (
      <View style={styles.subscribersOverlay}>
        <View style={styles.subscribersContainer}>
          <View style={styles.subscribersHeader}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
            <Text style={styles.subscribersTitle}>متابعة العامل</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={{ padding: IS_SMALL ? 12 : 16, paddingTop: 0 }}>
              <View style={styles.dateSelectors}>
                <TouchableOpacity style={styles.dateDropdown} onPress={() => setMonthPickerVisible(true)}>
                  <Text style={styles.dateDropdownText}>{selectedMonth}</Text>
                  <Ionicons name="calendar" size={20} color="#2196F3" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateDropdown} onPress={() => setYearPickerVisible(true)}>
                  <Text style={styles.dateDropdownText}>{selectedYear}</Text>
                  <Ionicons name="calendar" size={20} color="#2196F3" />
                </TouchableOpacity>
              </View>

              {onAddWorker && onEditWorker && (
                <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 8 : 10, marginTop: IS_SMALL ? 6 : 8, marginBottom: IS_SMALL ? 12 : 16 }}>
                  <TouchableOpacity style={{ flex: 1, backgroundColor: '#2196F3', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 10 : 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6 }} onPress={onAddWorker}>
                    <Ionicons name="person-add-outline" size={IS_SMALL ? 18 : 20} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 13 : 15 }}>إضافة عامل</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1, backgroundColor: '#2196F3', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 10 : 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6 }} onPress={onEditWorker}>
                    <Ionicons name="create-outline" size={IS_SMALL ? 18 : 20} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 13 : 15 }}>تعديل صلاحيات العامل</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={{ marginBottom: IS_SMALL ? 12 : 16 }}>
                <Text style={[styles.formLabel, { marginBottom: IS_SMALL ? 8 : 10, fontWeight: 'bold' }]}>اختر العامل</Text>
                <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: IS_SMALL ? 8 : 10 }}>
                  {(() => {
                    const pendingCounts = {};
                    (safePending || []).forEach(function(batch) {
                      const code = batch.workerCode || '';
                      const name = batch.workerName || '';
                      const key = code || name;
                      if (key) pendingCounts[key] = (pendingCounts[key] || 0) + 1;
                    });
                    return workers.map((w, idx) => {
                      const isSelected = selectedWorker && selectedWorker.code === w.code;
                      const workerKey = w.code || w.workerName || '';
                      const pendingCount = pendingCounts[workerKey] || 0;
                      return (
                        <TouchableOpacity key={idx} style={{ backgroundColor: isSelected ? '#FF9800' : '#F5F5F5', borderRadius: IS_SMALL ? 10 : 12, paddingVertical: IS_SMALL ? 10 : 12, paddingHorizontal: IS_SMALL ? 12 : 16, flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 8, borderWidth: 2, borderColor: isSelected ? '#FF9800' : '#E0E0E0', minWidth: IS_SMALL ? 120 : 140 }} onPress={() => setSelectedWorker(isSelected ? null : w)}>
                          <View style={{ backgroundColor: isSelected ? 'white' : '#FF9800', borderRadius: IS_SMALL ? 14 : 16, width: IS_SMALL ? 28 : 32, height: IS_SMALL ? 28 : 32, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="person" size={IS_SMALL ? 16 : 18} color={isSelected ? '#FF9800' : 'white'} />
                          </View>
                          <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: isSelected ? 'white' : '#333' }}>{w.workerName || 'بدون اسم'}</Text>
                          {pendingCount > 0 && (
                            <View style={{ backgroundColor: '#F44336', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 4 }}>
                              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 11 }}>{pendingCount}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    });
                  })()}
                </View>
              </View>

              {!selectedWorker ? (
                <View style={{ alignItems: 'center', marginTop: IS_SMALL ? 30 : 40 }}>
                  <Ionicons name="person-outline" size={IS_SMALL ? 50 : 60} color="#ccc" />
                  <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#999', marginTop: IS_SMALL ? 8 : 10 }}>اختر عامل لعرض بياناته</Text>
                </View>
              ) : (
              <>
              <View style={{ marginBottom: IS_SMALL ? 12 : 16 }}>
                <Text style={[styles.formLabel, { marginBottom: IS_SMALL ? 6 : 8, fontWeight: 'bold' }]}>ملخص الشهر - {selectedWorker.workerName || 'العامل'}</Text>
                {totalPendingCollected > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#E8F5E9', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 6 : 8 }}>
                    <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: '#2E7D32', fontWeight: 'bold' }}>اجمالي التحصيل:</Text>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 14, color: '#2E7D32', fontWeight: 'bold' }}>د.ع {formatNumber(totalPendingCollected)}</Text>
                  </View>
                )}
                {totalExpenses > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FFEBEE', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 6 : 8 }}>
                    <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: '#D32F2F', fontWeight: 'bold' }}>اجمالي الصرفيات:</Text>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(totalExpenses)}</Text>
                  </View>
                )}
                {totalPendingCollected === 0 && totalExpenses === 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F5F5F5', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12 }}>
                    <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: '#888' }}>لا توجد بيانات هذا الشهر</Text>
                  </View>
                )}
              </View>

              {expenses.length > 0 && (
                <View style={{ marginBottom: IS_SMALL ? 12 : 16 }}>
                  <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF3E0', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, borderWidth: 1, borderColor: '#FFCC80' }} onPress={() => setShowExpenses(!showExpenses)}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 8 }}>
                      <Ionicons name={showExpenses ? "chevron-down" : "chevron-back"} size={IS_SMALL ? 16 : 18} color="#E65100" />
                      <Text style={{ fontSize: IS_SMALL ? 13 : 14, color: '#333', fontWeight: 'bold' }}>الصرفيات</Text>
                    </View>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(totalExpenses)}</Text>
                  </TouchableOpacity>
                  {showExpenses && expenses.map((e, idx) => (
                    <View key={idx} style={{ backgroundColor: '#FFF8E1', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, marginTop: IS_SMALL ? 6 : 8, borderWidth: 1, borderColor: '#FFE082' }}>
                      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: IS_SMALL ? 2 : 4 }}>
                        <Text style={{ fontSize: IS_SMALL ? 13 : 14, color: '#333', fontWeight: 'bold' }}>{e.type}</Text>
                        <Text style={{ fontSize: IS_SMALL ? 13 : 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(e.amount)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>{e.workerName}</Text>
                        <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>{e.timestamp}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {expenses.length === 0 && safePending.length === 0 && (
                <View style={{ alignItems: 'center', marginTop: IS_SMALL ? 30 : 40 }}>
                  <Ionicons name="document-text-outline" size={IS_SMALL ? 50 : 60} color="#ccc" />
                  <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#999', marginTop: IS_SMALL ? 8 : 10 }}>لا توجد بيانات لهذا الشهر</Text>
                </View>
              )}

              {safePending.length > 0 && (
                <View style={{ marginTop: IS_SMALL ? 12 : 16, backgroundColor: '#FFF3E0', borderRadius: IS_SMALL ? 10 : 12, borderWidth: 1, borderColor: '#FF9800', overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: IS_SMALL ? 12 : 14, backgroundColor: '#FF9800' }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 8 }}>
                      <Ionicons name="notifications" size={IS_SMALL ? 18 : 20} color="white" />
                      <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: 'white' }}>تحديثات العامل</Text>
                    </View>
                    <View style={{ backgroundColor: 'white', borderRadius: IS_SMALL ? 8 : 10, paddingHorizontal: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 2 : 3 }}>
                      <Text style={{ color: '#FF9800', fontWeight: 'bold', fontSize: IS_SMALL ? 12 : 14 }}>{safePending.length}</Text>
                    </View>
                  </View>

                  {selectedBatch ? (
                    <View style={{ padding: IS_SMALL ? 10 : 12 }}>
                      <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6, marginBottom: IS_SMALL ? 10 : 12 }} onPress={() => setSelectedBatch(null)}>
                        <Ionicons name="arrow-forward" size={IS_SMALL ? 18 : 20} color="#333" />
                        <Text style={{ fontSize: IS_SMALL ? 13 : 14, fontWeight: 'bold', color: '#333' }}>رجوع للقائمة</Text>
                      </TouchableOpacity>
                      {(() => {
                        const selUpdates = selectedBatch.updates || [];
                        let selCollected = 0;
                        let selExpenses = 0;
                        for (let si = 0; si < selUpdates.length; si++) {
                          const su = selUpdates[si];
                          if (!su) continue;
                          if ((su.type === 'paid' || su.type === 'partialPayment') && su.details && su.details.amount) {
                            selCollected += parseFloat(su.details.amount);
                          } else if (su.type === 'addExpense') {
                            selExpenses += (su.details && su.details.amount) ? parseFloat(su.details.amount) : 0;
                          }
                        }
                        return (
                          <View style={{ borderRadius: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 10 : 12, overflow: 'hidden' }}>
                            {selCollected > 0 && (
                              <View style={{ backgroundColor: '#1565C0', padding: IS_SMALL ? 12 : 14 }}>
                                <Text style={{ fontSize: IS_SMALL ? 16 : 18, fontWeight: 'bold', color: 'white', textAlign: 'center', marginBottom: IS_SMALL ? 4 : 6 }}>د.ع {formatNumber(selCollected)}</Text>
                                <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>{selectedBatch.workerName || ''} - {selectedBatch.timestamp || ''}</Text>
                              </View>
                            )}
                            {selExpenses > 0 && (
                              <View style={{ backgroundColor: '#C62828', padding: IS_SMALL ? 12 : 14, marginTop: selCollected > 0 ? 2 : 0 }}>
                                <Text style={{ fontSize: IS_SMALL ? 16 : 18, fontWeight: 'bold', color: 'white', textAlign: 'center', marginBottom: IS_SMALL ? 4 : 6 }}>د.ع {formatNumber(selExpenses)}</Text>
                                <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>صرفيات - {selectedBatch.workerName || ''}</Text>
                              </View>
                            )}
                            {selCollected === 0 && selExpenses === 0 && (
                              <View style={{ backgroundColor: '#9E9E9E', padding: IS_SMALL ? 12 : 14 }}>
                                <Text style={{ fontSize: IS_SMALL ? 16 : 18, fontWeight: 'bold', color: 'white', textAlign: 'center', marginBottom: IS_SMALL ? 4 : 6 }}>د.ع 0</Text>
                                <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>{selectedBatch.workerName || ''} - {selectedBatch.timestamp || ''}</Text>
                              </View>
                            )}
                          </View>
                        );
                      })()}
                      {(selectedBatch.updates || []).map(function(u, idx) {
                        if (!u) return null;
                        let typeLabel = '';
                        let typeColor = '#333';
                        let bgColor = '#f8f8f8';
                        let iconName = 'document-text';
                        let iconColor = '#999';
                        let detailText = '';
                        if (u.type === 'paid') { typeLabel = 'دفع اشتراك'; typeColor = '#2E7D32'; bgColor = '#E8F5E9'; iconName = 'checkmark-circle'; iconColor = '#4CAF50'; detailText = 'المبلغ: ' + formatNumber((u.details && u.details.amount) ? parseFloat(u.details.amount) : 0) + ' د.ع'; }
                        else if (u.type === 'partialPayment') { typeLabel = 'دفع جزئي'; typeColor = '#E65100'; bgColor = '#FFF3E0'; iconName = 'wallet'; iconColor = '#FF9800'; detailText = 'المبلغ: ' + formatNumber((u.details && u.details.amount) ? parseFloat(u.details.amount) : 0) + ' د.ع'; }
                        else if (u.type === 'cancelled') { typeLabel = 'الغاء الدفع'; typeColor = '#C62828'; bgColor = '#FFEBEE'; iconName = 'close-circle'; iconColor = '#FF5722'; }
                        else if (u.type === 'delete') { typeLabel = 'حذف'; typeColor = '#BF360C'; bgColor = '#FBE9E7'; iconName = 'trash'; iconColor = '#D84315'; }
                        else if (u.type === 'add') { typeLabel = 'اضافة مشترك'; typeColor = '#2E7D32'; bgColor = '#E8F5E9'; iconName = 'person-add'; iconColor = '#2E7D32'; detailText = 'مشترك جديد - ' + (u.amper || '') + ' امبير'; }
                        else if (u.type === 'edit') { typeLabel = 'تعديل'; typeColor = '#1565C0'; bgColor = '#E3F2FD'; iconName = 'create'; iconColor = '#1565C0'; }
                        else if (u.type === 'restore') { typeLabel = 'استعادة'; typeColor = '#1565C0'; bgColor = '#E3F2FD'; iconName = 'refresh'; iconColor = '#1565C0'; }
                        else if (u.type === 'addExpense') { typeLabel = 'صرفية'; typeColor = '#E65100'; bgColor = '#FFF3E0'; iconName = 'receipt'; iconColor = '#FF9800'; detailText = 'نوع: ' + ((u.details && u.details.expenseType) || u.subscriberName || '') + ' - المبلغ: ' + formatNumber((u.details && u.details.amount) || 0) + ' د.ع'; }
                        let monthLabel = u.monthKey || '';
                        if (monthLabel && monthLabel.indexOf('_') !== -1) { const p = monthLabel.split('_'); monthLabel = 'الشهر ' + p[0] + '/' + p[1]; }
                        return (
                          <View key={u.id || ('u' + idx)} style={{ backgroundColor: bgColor, borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 6 : 8, borderWidth: 1, borderColor: '#eee' }}>
                            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', flex: 1 }}>
                                <Ionicons name={iconName} size={IS_SMALL ? 16 : 18} color={iconColor} />
                                <Text style={{ fontSize: IS_SMALL ? 13 : 14, fontWeight: 'bold', color: typeColor, marginRight: IS_SMALL ? 4 : 6 }}>{typeLabel}</Text>
                              </View>
                              {monthLabel ? <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#888' }}>{monthLabel}</Text> : null}
                            </View>
                            <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: '#333', fontWeight: '600', marginTop: IS_SMALL ? 4 : 6, textAlign: 'right' }}>{u.subscriberName || ''}</Text>
                            {detailText ? <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#666', marginTop: IS_SMALL ? 2 : 3, textAlign: 'right' }}>{detailText}</Text> : null}
                          </View>
                        );
                      })}
                      <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 8 : 10, paddingVertical: IS_SMALL ? 10 : 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginTop: IS_SMALL ? 6 : 8 }} onPress={() => { onApplyBatch(selectedBatch.id); setSelectedBatch(null); }}>
                        <Ionicons name="checkmark-done" size={IS_SMALL ? 18 : 20} color="white" />
                        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 13 : 14 }}>تطبيق التغييرات</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ padding: IS_SMALL ? 10 : 12 }}>
                      {safePending.map(function(batch) {
                        let updates = Array.isArray(batch.updates) ? batch.updates : [];
                        let batchCollected = 0;
                        let batchExpenseOnly = true;
                        for (let k = 0; k < updates.length; k++) {
                          const u = updates[k];
                          if (!u) continue;
                          if ((u.type === 'paid' || u.type === 'partialPayment') && u.details && u.details.amount) {
                            batchCollected += parseFloat(u.details.amount);
                            batchExpenseOnly = false;
                          } else if (u.type === 'addExpense') {
                            batchCollected += (u.details && u.details.amount) ? parseFloat(u.details.amount) : 0;
                          }
                        }
                        return (
                          <TouchableOpacity key={batch.id || 'b'} style={{ backgroundColor: viewedBatches.indexOf(batch.id) >= 0 ? '#E8F5E9' : 'white', borderRadius: IS_SMALL ? 10 : 12, padding: IS_SMALL ? 12 : 14, marginBottom: IS_SMALL ? 8 : 10, borderWidth: 1.5, borderColor: viewedBatches.indexOf(batch.id) >= 0 ? '#4CAF50' : '#FFD54F' }} onPress={() => { setSelectedBatch(batch); markBatchViewed(batch.id); }}>
                            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: IS_SMALL ? 2 : 4 }}>
                              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6 }}>
                                <View style={{ backgroundColor: batchExpenseOnly ? '#D32F2F' : '#FF9800', borderRadius: IS_SMALL ? 8 : 10, paddingHorizontal: IS_SMALL ? 6 : 8, paddingVertical: IS_SMALL ? 2 : 3 }}>
                                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 11 : 12 }}>د.ع {formatNumber(batchCollected)}</Text>
                                </View>
                                <Text style={{ fontSize: IS_SMALL ? 13 : 14, fontWeight: 'bold', color: '#333' }}>{batch.workerName || ''}</Text>
                              </View>
                              <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>{batch.timestamp || ''}</Text>
                            </View>
                            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: IS_SMALL ? 6 : 8 }}>
                              <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: '#666' }}>عدد التحديثات: {updates.length}</Text>
                              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 8 }}>
                                <TouchableOpacity onPress={(e) => { e.stopPropagation && e.stopPropagation(); Alert.alert('حذف التحديث', 'هل تريد حذف هذا التحديث؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress: () => onDeleteBatch(batch.id) }]); }} style={{ backgroundColor: '#FFEBEE', borderRadius: IS_SMALL ? 5 : 6, padding: IS_SMALL ? 5 : 6 }}>
                                  <Ionicons name="trash-outline" size={IS_SMALL ? 14 : 16} color="#F44336" />
                                </TouchableOpacity>
                                <Ionicons name="chevron-back" size={IS_SMALL ? 16 : 18} color="#999" />
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                      {safeRejected.length > 0 && (
                        <View style={{ marginTop: IS_SMALL ? 10 : 12 }}>
                          <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6, marginBottom: IS_SMALL ? 6 : 8 }} onPress={() => setShowRejected(!showRejected)}>
                            <Ionicons name={showRejected ? "chevron-down" : "chevron-forward"} size={IS_SMALL ? 16 : 18} color="#F44336" />
                            <Text style={{ fontSize: IS_SMALL ? 12 : 13, fontWeight: 'bold', color: '#F44336' }}>المرفوضات ({safeRejected.length})</Text>
                          </TouchableOpacity>
                          {showRejected && safeRejected.map(function(batch) {
                            let updates = Array.isArray(batch.updates) ? batch.updates : [];
                            return (
                              <View key={batch.id || 'rb'} style={{ backgroundColor: '#FFEBEE', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 6 : 8, borderWidth: 1, borderColor: '#FFCDD2' }}>
                                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: IS_SMALL ? 4 : 6 }}>
                                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6 }}>
                                    <View style={{ backgroundColor: '#F44336', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: IS_SMALL ? 11 : 12 }}>مرفوض</Text>
                                    </View>
                                    <Text style={{ fontSize: IS_SMALL ? 12 : 13, fontWeight: 'bold', color: '#C62828' }}>#{batch.number || ''} - {batch.workerName || ''}</Text>
                                  </View>
                                  <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>{batch.timestamp || ''}</Text>
                                </View>
                                {updates.map(function(update, idx) {
                                  const typeLabels = { paid: 'دفع', cancelled: 'إلغاء دفع', add: 'إضافة مشترك', edit: 'تعديل', delete: 'حذف', restore: 'استعادة', addExpense: 'صرفية', partialPayment: 'دفع جزئي' };
                                  const typeColors = { paid: '#4CAF50', cancelled: '#FF9800', add: '#2196F3', edit: '#9C27B0', delete: '#F44336', restore: '#00BCD4', addExpense: '#FF5722', partialPayment: '#FF9800' };
                                  return (
                                    <View key={idx} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6, paddingVertical: 2 }}>
                                      <View style={{ backgroundColor: typeColors[update.type] || '#999', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                                        <Text style={{ color: 'white', fontSize: IS_SMALL ? 10 : 11, fontWeight: 'bold' }}>{typeLabels[update.type] || update.type}</Text>
                                      </View>
                                      <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#555', flex: 1 }}>{update.subscriberName || ''}</Text>
                                    </View>
                                  );
                                })}
                                <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#F44336', marginTop: IS_SMALL ? 4 : 6, fontWeight: 'bold' }}>تم الرفض نهائياً - لا يمكن التراجع</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
              </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
  );

  if (fullScreen) {
    return (
      <View style={{ flex: 1 }}>
        {trackingModalContent}
        <MonthPickerModal visible={monthPickerVisible} onClose={() => setMonthPickerVisible(false)} onSelect={setSelectedMonth} selectedMonth={selectedMonth} />
        <YearPickerModal visible={yearPickerVisible} onClose={() => setYearPickerVisible(false)} onSelect={setSelectedYear} selectedYear={selectedYear} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      {trackingModalContent}
    </Modal>
    <MonthPickerModal visible={monthPickerVisible} onClose={() => setMonthPickerVisible(false)} onSelect={setSelectedMonth} selectedMonth={selectedMonth} />
    <YearPickerModal visible={yearPickerVisible} onClose={() => setYearPickerVisible(false)} onSelect={setSelectedYear} selectedYear={selectedYear} />
    </View>
  );
};

const AddSubscriberModal = ({ visible, onClose, onSave, selectedMonth, selectedYear, defaultSubscriptionType }) => {
  const { showNotification } = useNotification();
  const [name, setName] = useState('');
  const [amper, setAmper] = useState('');
  const [subscriberNumber, setSubscriberNumber] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [visaNumber, setVisaNumber] = useState('');
  const [subscriptionType, setSubscriptionType] = useState(defaultSubscriptionType || 'normal');

  useEffect(() => {
    if (visible) setSubscriptionType(defaultSubscriptionType || 'normal');
  }, [visible, defaultSubscriptionType]);

  const handleSave = () => {
    const nameError = validateName(name);
    if (nameError) {
      showNotification('warning', 'تنبيه', nameError);
      return;
    }
    const amperError = validateAmper(amper);
    if (amperError) {
      showNotification('warning', 'تنبيه', amperError);
      return;
    }

    const now = new Date();
    const amperVal = parseInt(amper) || 0;
    const newSubscriber = {
      id: Date.now().toString(),
      name: name.trim(),
      amper: amperVal,
      subscriberNumber: subscriberNumber.trim(),
      meterNumber: meterNumber.trim(),
      visaNumber: visaNumber.trim(),
      subscriptionType: subscriptionType,
      paid: false,
      paidMonths: {},
      paymentHistory: [],
      partialPayments: {},
      amperHistory: [{ monthKey: `${selectedMonth}_${selectedYear}`, amper: amperVal }],
      date: now.toISOString(),
      addedMonth: parseInt(selectedMonth),
      addedYear: parseInt(selectedYear),
    };

    onSave(newSubscriber);
    setName('');
    setAmper('');
    setSubscriberNumber('');
    setMeterNumber('');
    setVisaNumber('');
    setSubscriptionType('normal');
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.subscribersOverlay}>
        <View style={styles.subscribersContainer}>
          <View style={styles.subscribersHeader}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
            <Text style={styles.subscribersTitle}>إضافة مشترك</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={{ padding: IS_SMALL ? 14 : 20 }}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>اسم المشترك <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.formInput} value={name} onChangeText={setName} placeholder="أدخل اسم المشترك" placeholderTextColor="#999" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>عدد الأمبيرات <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.formInput} value={amper} onChangeText={(t) => setAmper(onlyDigits(t))} placeholder="أدخل عدد الأمبيرات" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>رقم المشترك</Text>
                <TextInput style={styles.formInput} value={subscriberNumber} onChangeText={(t) => setSubscriberNumber(onlyDigits(t))} placeholder="أدخل رقم المشترك" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>رقم الجوزة</Text>
                <TextInput style={styles.formInput} value={meterNumber} onChangeText={(t) => setMeterNumber(onlyDigits(t))} placeholder="أدخل رقم الجوزة" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>رقم الفيز</Text>
                <TextInput style={styles.formInput} value={visaNumber} onChangeText={setVisaNumber} placeholder="أدخل رقم الفيز" placeholderTextColor="#999" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>نوع الاشتراك</Text>
                <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 8 : 10 }}>
                  <TouchableOpacity
                    style={[styles.subscriptionTypeBtn, subscriptionType === 'normal' && styles.subscriptionTypeBtnActive]}
                    onPress={() => setSubscriptionType('normal')}
                  >
                    <Text style={[styles.subscriptionTypeBtnText, subscriptionType === 'normal' && styles.subscriptionTypeBtnTextActive]}>اشتراك عادي</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.subscriptionTypeBtn, subscriptionType === 'golden' && styles.subscriptionTypeBtnActiveGold]}
                    onPress={() => setSubscriptionType('golden')}
                  >
                    <Text style={[styles.subscriptionTypeBtnText, subscriptionType === 'golden' && styles.subscriptionTypeBtnTextActiveGold]}>اشتراك ذهبي</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity style={styles.saveSubscriberButton} onPress={handleSave}>
                <Ionicons name="checkmark-circle" size={22} color="white" />
                <Text style={styles.saveSubscriberText}>حفظ المشترك</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const EditSubscriberModal = ({ visible, onClose, subscriber, onSave, selectedMonth, selectedYear, isPaid }) => {
  const { showNotification } = useNotification();
  const [name, setName] = useState('');
  const [amper, setAmper] = useState('');
  const [subscriberNumber, setSubscriberNumber] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [visaNumber, setVisaNumber] = useState('');
  const [subscriptionType, setSubscriptionType] = useState('normal');

  useEffect(() => {
    if (subscriber) {
      setName(subscriber.name || '');
      setAmper(String(subscriber.amper || ''));
      setSubscriberNumber(subscriber.subscriberNumber || '');
      setMeterNumber(subscriber.meterNumber || '');
      setVisaNumber(subscriber.visaNumber || '');
      setSubscriptionType(subscriber.subscriptionType || 'normal');
    }
  }, [subscriber]);

  const handleSave = () => {
    const nameError = validateName(name);
    if (nameError) {
      showNotification('warning', 'تنبيه', nameError);
      return;
    }
    if (!isPaid) {
      const amperError = validateAmper(amper);
      if (amperError) {
        showNotification('warning', 'تنبيه', amperError);
        return;
      }
    }
    const amperVal = parseInt(amper) || 0;
    const updatedSubscriber = {
      ...subscriber,
      name: name.trim(),
      subscriberNumber: subscriberNumber.trim(),
      meterNumber: meterNumber.trim(),
      visaNumber: visaNumber.trim(),
      subscriptionType: subscriptionType,
    };
    const currentMonthAmper = getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear));
    if (!isPaid && amperVal !== currentMonthAmper) {
      updatedSubscriber.amperHistory = [
        ...(subscriber.amperHistory || []),
        { monthKey: `${selectedMonth}_${selectedYear}`, amper: amperVal },
      ].sort((a, b) => {
        const [aM, aY] = a.monthKey.split('_').map(Number);
        const [bM, bY] = b.monthKey.split('_').map(Number);
        return aY !== bY ? aY - bY : aM - bM;
      });
    }
    onSave(updatedSubscriber);
    onClose();
  };

  if (!visible || !subscriber) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.subscribersOverlay}>
        <View style={styles.subscribersContainer}>
          <View style={styles.subscribersHeader}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
            <Text style={styles.subscribersTitle}>تعديل المشترك</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={{ padding: IS_SMALL ? 14 : 20 }}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>اسم المشترك <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.formInput} value={name} onChangeText={setName} placeholderTextColor="#999" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>عدد الأمبيرات <Text style={styles.required}>*</Text></Text>
                {isPaid && <Text style={{ color: '#FF9800', fontSize: IS_SMALL ? 11 : 12, marginBottom: IS_SMALL ? 2 : 4 }}>لا يمكن تغيير الأمبير - المشترك دافع الشهر الحالي</Text>}
                <TextInput style={[styles.formInput, isPaid && { backgroundColor: '#f0f0f0', color: '#999' }]} value={amper} onChangeText={(t) => setAmper(onlyDigits(t))} placeholderTextColor="#999" keyboardType="numeric" textAlign="right" editable={!isPaid} />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>رقم المشترك</Text>
                <TextInput style={styles.formInput} value={subscriberNumber} onChangeText={(t) => setSubscriberNumber(onlyDigits(t))} placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>رقم الجوزة</Text>
                <TextInput style={styles.formInput} value={meterNumber} onChangeText={(t) => setMeterNumber(onlyDigits(t))} placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>رقم الفيز</Text>
                <TextInput style={styles.formInput} value={visaNumber} onChangeText={setVisaNumber} placeholderTextColor="#999" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>نوع الاشتراك</Text>
                <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 8 : 10 }}>
                  <TouchableOpacity
                    style={[styles.subscriptionTypeBtn, subscriptionType === 'normal' && styles.subscriptionTypeBtnActive]}
                    onPress={() => setSubscriptionType('normal')}
                  >
                    <Text style={[styles.subscriptionTypeBtnText, subscriptionType === 'normal' && styles.subscriptionTypeBtnTextActive]}>اشتراك عادي</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.subscriptionTypeBtn, subscriptionType === 'golden' && styles.subscriptionTypeBtnActiveGold]}
                    onPress={() => setSubscriptionType('golden')}
                  >
                    <Text style={[styles.subscriptionTypeBtnText, subscriptionType === 'golden' && styles.subscriptionTypeBtnTextActiveGold]}>اشتراك ذهبي</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity style={styles.saveSubscriberButton} onPress={handleSave}>
                <Ionicons name="checkmark-circle" size={22} color="white" />
                <Text style={styles.saveSubscriberText}>حفظ التعديلات</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const PartialPaymentModal = ({ visible, onClose, subscriber, amperPrices, goldenPrices, monthKey, onConfirm, darkMode }) => {
  const [amount, setAmount] = useState('');
  const pmMonth = monthKey ? monthKey.split('_')[0] : '1';
  const pmYear = monthKey ? monthKey.split('_')[1] : '2026';
  const price = getPriceForSubscriber(amperPrices, goldenPrices, monthKey, subscriber ? subscriber.subscriptionType : 'normal');
  const totalDue = (subscriber ? getAmperForMonth(subscriber, pmMonth, pmYear) : 0) * price;
  const existingPayments = (subscriber && subscriber.partialPayments && subscriber.partialPayments[monthKey]) || [];
  const totalPaid = existingPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const remaining = totalDue - totalPaid;

  useEffect(() => {
    if (!visible) return;
    var sub = BackHandler.addEventListener('hardwareBackPress', function() {
      onClose();
      return true;
    });
    return function() { sub.remove(); };
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.subscribersOverlay}>
      <View style={styles.subscribersContainer}>
        <View style={styles.subscribersHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-forward" size={26} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.subscribersTitle}>دفع جزئي</Text>
            <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: 'rgba(255,255,255,0.85)', fontWeight: 'bold', marginTop: 2 }}>{subscriber ? subscriber.name : ''}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
          <View style={{ padding: IS_SMALL ? 12 : 16 }}>
            <View style={{ backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5', borderRadius: IS_SMALL ? 10 : 12, padding: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 10 : 14, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#999' }}>{subscriber ? getAmperForMonth(subscriber, pmMonth, pmYear) : 0} أميبر</Text>
              <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#999' }}>{subscriber && subscriber.subscriptionType === 'golden' ? 'اشتراك ذهبي' : 'اشتراك عادي'}</Text>
            </View>

            <View style={{ backgroundColor: darkMode ? '#2a2a2a' : '#fff', borderRadius: IS_SMALL ? 10 : 12, padding: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 10 : 14, borderWidth: 1, borderColor: darkMode ? '#333' : '#eee' }}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: IS_SMALL ? 6 : 8 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#aaa' : '#666' }}>المبلغ الواجب دفعه</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: darkMode ? '#fff' : '#333' }}>د.ع {formatNumber(totalDue)}</Text>
              </View>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: IS_SMALL ? 6 : 8 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#aaa' : '#666' }}>الواصل</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: '#4CAF50' }}>د.ع {formatNumber(totalPaid)}</Text>
              </View>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#aaa' : '#666' }}>المتبقي</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: '#F44336' }}>د.ع {formatNumber(remaining)}</Text>
              </View>
            </View>

            <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', marginBottom: IS_SMALL ? 6 : 8, textAlign: 'right' }}>ادخل مبلغ الدفع</Text>
            <TextInput style={{ backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 14, fontSize: IS_SMALL ? 18 : 22, borderWidth: 1, borderColor: darkMode ? '#444' : '#e0e0e0', textAlign: 'center', color: darkMode ? '#fff' : '#333', fontWeight: 'bold', marginBottom: IS_SMALL ? 14 : 20 }} value={amount} onChangeText={(t) => { const raw = t.replace(/[^0-9]/g, ''); if (raw) { setAmount(formatNumber(parseInt(raw))); } else { setAmount(''); } }} placeholder="0" placeholderTextColor="#999" keyboardType="numeric" />

            <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 10 : 12, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: IS_SMALL ? 6 : 8 }} onPress={() => {
              const parsed = parseFloat(amount.replace(/,/g, ''));
              if (!parsed || parsed <= 0) { Alert.alert('خطأ', 'أدخل مبلغ صحيح'); return; }
              if (parsed > remaining) { Alert.alert('خطأ', 'المبلغ المدخل أكبر من المتبقي. الحد الأقصى المسموح: ' + formatNumber(remaining) + ' د.ع'); return; }
              onConfirm(parsed);
              setAmount('');
              onClose();
            }}>
              <Ionicons name="checkmark-circle" size={IS_SMALL ? 18 : 22} color="white" />
              <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>تأكيد الدفع</Text>
            </TouchableOpacity>

            {remaining > 0 && (
              <TouchableOpacity style={{ backgroundColor: '#2196F3', borderRadius: IS_SMALL ? 10 : 12, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 8 : 10, flexDirection: 'row', justifyContent: 'center', gap: IS_SMALL ? 6 : 8 }} onPress={() => {
                Alert.alert('دفع المتبقي', 'هل تريد دفع المتبقي بالكامل؟\nالمبلغ: د.ع ' + formatNumber(remaining), [
                  { text: 'إلغاء', style: 'cancel' },
                  { text: 'نعم', onPress: () => { onConfirm(remaining); onClose(); } },
                ]);
              }}>
                <Ionicons name="wallet" size={IS_SMALL ? 18 : 22} color="white" />
                <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>دفع المتبقي كاملاً ({formatNumber(remaining)} د.ع)</Text>
              </TouchableOpacity>
            )}

            {existingPayments.length > 0 && (
              <View style={{ marginTop: IS_SMALL ? 14 : 18 }}>
                <Text style={{ fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', marginBottom: IS_SMALL ? 8 : 10, textAlign: 'right' }}>سجل الدفعات الجزئية</Text>
                {existingPayments.slice().reverse().map((p, idx) => (
                  <View key={idx} style={{ backgroundColor: darkMode ? '#2a2a2a' : '#F5F5F5', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 6 : 8, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#4CAF50', fontWeight: 'bold' }}>د.ع {formatNumber(parseFloat(p.amount) || 0)}</Text>
                      {p.ownerName ? <Text style={{ fontSize: IS_SMALL ? 10 : 12, color: '#999', marginTop: 2 }}>{p.ownerName}</Text> : null}
                    </View>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>{p.timestamp || '-'}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
};

const ChangeAmperModal = ({ visible, onClose, subscriber, selectedMonth, selectedYear, onConfirm, amperPrices, onSaveAmperPrice }) => {
  const { showNotification } = useNotification();
  const [newAmper, setNewAmper] = useState('');
  const [changeMonth, setChangeMonth] = useState(selectedMonth);
  const [changeYear, setChangeYear] = useState(selectedYear);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  useEffect(() => {
    if (subscriber) {
      const currentAmper = getAmperForMonth(subscriber, selectedMonth, selectedYear);
      setNewAmper(currentAmper.toString());
      setChangeMonth(selectedMonth);
      setChangeYear(selectedYear);
    }
  }, [subscriber, selectedMonth, selectedYear]);

  const handleConfirm = () => {
    const parsed = parseInt(newAmper);
    if (!parsed || parsed <= 0 || parsed > 100) {
      showNotification('error', 'خطأ', 'أدخل عدد أمبير صحيح بين 1 و 100');
      return;
    }
    onConfirm(parsed, changeMonth, changeYear);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.partialModalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>تغيير الأمبير</Text>
            <View style={{ width: 30 }} />
          </View>

          <View style={styles.partialSubscriberInfo}>
            <Text style={styles.partialSubscriberName}>{subscriber ? subscriber.name : ''}</Text>
          </View>

          <View style={styles.dateSelectors}>
            <TouchableOpacity style={styles.dateDropdown} onPress={() => setMonthPickerVisible(true)}>
              <Text style={styles.dateDropdownText}>{changeMonth}</Text>
              <Ionicons name="calendar" size={20} color="#2196F3" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateDropdown} onPress={() => setYearPickerVisible(true)}>
              <Text style={styles.dateDropdownText}>{changeYear}</Text>
              <Ionicons name="calendar" size={20} color="#2196F3" />
            </TouchableOpacity>
          </View>

          {(() => {
            const now = new Date();
            const curMonth = now.getMonth() + 1;
            const curYear = now.getFullYear();
            const selMonth = parseInt(changeMonth);
            const selYear = parseInt(changeYear);
            const isFuture = (selYear > curYear) || (selYear === curYear && selMonth > curMonth);
            if (!isFuture) return null;
            const priceKey = `${changeMonth}_${changeYear}`;
            return (
              <View style={styles.dateSelectors}>
                <TextInput
                  style={[styles.dateDropdown, { borderWidth: 1, borderColor: '#2196F3', textAlign: 'center' }]}
                  value={amperPrices && amperPrices[priceKey] ? String(amperPrices[priceKey]) : ''}
                  onChangeText={(val) => onSaveAmperPrice && onSaveAmperPrice(priceKey, onlyDigits(val))}
                  keyboardType="numeric"
                  placeholder="سعر الأميبر لهذا الشهر"
                  placeholderTextColor="#999"
                />
                <Text style={{ color: '#2196F3', fontWeight: 'bold', alignSelf: 'center' }}>سعر الأميبر</Text>
              </View>
            );
          })()}

          <View style={styles.partialInputGroup}>
            <Text style={styles.partialInputLabel}>عدد الأمبيرات الجديد</Text>
            <TextInput
              style={styles.partialInput}
              value={newAmper}
              onChangeText={(t) => setNewAmper(onlyDigits(t))}
              placeholder="0"
              placeholderTextColor="#999"
              keyboardType="numeric"
              textAlign="center"
            />
          </View>

          <TouchableOpacity style={styles.partialConfirmButton} onPress={handleConfirm}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.partialConfirmText}>تأكيد التغيير</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};
const SubscribersScreen = ({ visible, onClose, subscribers, onDeleteSubscriber, onSaveSubscriber, onTogglePaid, onPartialPayment, onRestoreSubscriber, amperPrices, goldenPrices, onSaveGoldenPrice, currentUser, ownerName, onChangeAmper, onSaveAmperPrice, userRole, workerPermissions, fullScreen, darkMode, lastMonth, lastYear, onSaveLastMonth, onOpenPartialPayment, onMultiMonthPayment, onOpenMultiMonthPayment }) => {
  const { showNotification } = useNotification();
  const [selectedMonth, setSelectedMonth] = useState(lastMonth || String(new Date().getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(lastYear || String(new Date().getFullYear()));
  const [searchText, setSearchText] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [subscriptionTypeFilter, setSubscriptionTypeFilter] = useState('normal');
  const [addSubscriberVisible, setAddSubscriberVisible] = useState(false);
  const [changeAmperVisible, setChangeAmperVisible] = useState(false);
  const [changeAmperSubscriber, setChangeAmperSubscriber] = useState(null);
  const [editSubscriberVisible, setEditSubscriberVisible] = useState(false);
  const [editSubscriber, setEditSubscriber] = useState(null);
  const [editPickerVisible, setEditPickerVisible] = useState(false);
  const [editPickerSearch, setEditPickerSearch] = useState('');
  const [deletePickerVisible, setDeletePickerVisible] = useState(false);
  const [deletePickerSearch, setDeletePickerSearch] = useState('');
  const [deletePickerMode, setDeletePickerMode] = useState('delete');
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);

  useEffect(() => {
    if (visible) {
      const now = new Date();
      setSelectedMonth(String(now.getMonth() + 1));
      setSelectedYear(String(now.getFullYear()));
    } else {
      setSearchText('');
      setActiveFilter('all');
      setSubscriptionTypeFilter('normal');
      setExpandedCard(null);
    }
  }, [visible]);
  const [displayCount, setDisplayCount] = useState(15);

  const PAGE_SIZE = 15;

  useEffect(() => { setDisplayCount(PAGE_SIZE); }, [selectedMonth, selectedYear, searchText, activeFilter, visible]);

  useEffect(() => { if (visible) { setSelectedMonth(lastMonth || String(new Date().getMonth() + 1)); setSelectedYear(lastYear || String(new Date().getFullYear())); } }, [visible, lastMonth, lastYear]);

  useEffect(() => { if (onSaveLastMonth) onSaveLastMonth(selectedMonth, selectedYear); }, [selectedMonth, selectedYear]);

  useEffect(() => {
    if (!editPickerVisible && !deletePickerVisible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', function() {
      if (editPickerVisible) { setEditPickerVisible(false); setEditPickerSearch(''); return true; }
      if (deletePickerVisible) { setDeletePickerVisible(false); setDeletePickerSearch(''); return true; }
      return false;
    });
    return () => handler.remove();
  }, [editPickerVisible, deletePickerVisible]);

  const monthKey = `${selectedMonth}_${selectedYear}`;
  const isPaid = (sub) => sub.paidMonths && sub.paidMonths[monthKey];

  const isVisibleForMonth = (sub, selMonth, selYear) => {
    const subMonth = sub.addedMonth ? parseInt(sub.addedMonth) : 1;
    const subYear = sub.addedYear ? parseInt(sub.addedYear) : new Date().getFullYear();
    const isAfterAdded = (selYear > subYear) || (selYear === subYear && selMonth >= subMonth);
    if (!isAfterAdded) return false;
    if (sub.deletedFromMonth) {
      const delParts = sub.deletedFromMonth.split('_');
      const delMonth = parseInt(delParts[0]);
      const delYear = parseInt(delParts[1]);
      const isDeleted = (selYear > delYear) || (selYear === delYear && selMonth >= delMonth);
      if (isDeleted) return false;
    }
    return true;
  };

  const isOwner = userRole !== 'worker';
  const canDelete = isOwner || workerPermissions.includes('delete');
  const canEdit = isOwner || workerPermissions.includes('edit');
  const canAdd = isOwner || workerPermissions.includes('add');
  const canChangeAmperPrice = isOwner || workerPermissions.includes('amperPrice');
  const canCancelPayment = isOwner || workerPermissions.includes('cancelPayment');
  const canPartialPayment = isOwner || workerPermissions.includes('partialPayment');

  const hasPartialPayments = (sub) => {
    const pp = sub.partialPayments && sub.partialPayments[monthKey];
    return pp && pp.length > 0;
  };

  const { visibleSubscribers, deletedForMonth, visibleCount, paidCount, requiredCount, unpaidCount, filteredSubscribers, filteredDeleted } = useMemo(() => {
    const vs = subscribers.filter(sub => isVisibleForMonth(sub, parseInt(selectedMonth), parseInt(selectedYear)) && (sub.subscriptionType || 'normal') === subscriptionTypeFilter);
    const df = subscribers.filter(sub => isDeletedForReport(sub, selectedMonth, selectedYear) && (sub.subscriptionType || 'normal') === subscriptionTypeFilter);
    const vc = vs.length;
    const pc = vs.filter(s => isPaid(s)).length;
    const rc = vs.filter(s => !isPaid(s) && hasPartialPayments(s)).length;
    const uc = vs.filter(s => !isPaid(s) && !hasPartialPayments(s)).length;
    const fs = vs.filter(sub => {
      const matchesSearch = sub.name.includes(searchText) ||
        (sub.subscriberNumber && sub.subscriberNumber.includes(searchText)) ||
        (sub.meterNumber && sub.meterNumber.includes(searchText));
      if (activeFilter === 'paid') return matchesSearch && isPaid(sub);
      if (activeFilter === 'unpaid') return matchesSearch && !isPaid(sub) && !hasPartialPayments(sub);
      if (activeFilter === 'required') return matchesSearch && !isPaid(sub) && hasPartialPayments(sub);
      return matchesSearch;
    }).sort(function(a, b) {
      if (activeFilter === 'all' || activeFilter === 'total' || activeFilter === 'deleted') {
        var aAdded = (a.addedYear || 0) * 100 + (a.addedMonth || 0);
        var bAdded = (b.addedYear || 0) * 100 + (b.addedMonth || 0);
        if (aAdded !== bAdded) return bAdded - aAdded;
        return (b.id || '').localeCompare(a.id || '');
      }
      if (activeFilter === 'required') {
        var aPP = (a.partialPayments && a.partialPayments[monthKey]) || [];
        var bPP = (b.partialPayments && b.partialPayments[monthKey]) || [];
        var aLastPP = aPP.length > 0 ? aPP[aPP.length - 1].timestamp : '';
        var bLastPP = bPP.length > 0 ? bPP[bPP.length - 1].timestamp : '';
        return bLastPP.localeCompare(aLastPP);
      }
      var aHistory = (a.paymentHistory || []).filter(function(h) { return h.monthKey === monthKey; });
      var bHistory = (b.paymentHistory || []).filter(function(h) { return h.monthKey === monthKey; });
      var aLast = aHistory.length > 0 ? aHistory[aHistory.length - 1].timestamp : '';
      var bLast = bHistory.length > 0 ? bHistory[bHistory.length - 1].timestamp : '';
      return bLast.localeCompare(aLast);
    });
    const fd = df.filter(sub => {
      return sub.name.includes(searchText) ||
        (sub.subscriberNumber && sub.subscriberNumber.includes(searchText)) ||
        (sub.meterNumber && sub.meterNumber.includes(searchText));
    });
    return { visibleSubscribers: vs, deletedForMonth: df, visibleCount: vc, paidCount: pc, requiredCount: rc, unpaidCount: uc, filteredSubscribers: fs, filteredDeleted: fd };
  }, [subscribers, selectedMonth, selectedYear, searchText, activeFilter, monthKey, subscriptionTypeFilter]);

  const filters = [
    { id: 'total', label: 'الإجمالي اشتراك', count: visibleCount },
    { id: 'required', label: 'المطلوبين', count: requiredCount },
    { id: 'unpaid', label: 'غير مدفوع', count: unpaidCount },
    { id: 'paid', label: 'مدفوع', count: paidCount },
    { id: 'deleted', label: 'المحذوفين', count: deletedForMonth.length },
    { id: 'all', label: 'الكل', count: visibleCount },
  ];

  const paginatedSubscribers = filteredSubscribers.slice(0, displayCount);
  const hasMore = filteredSubscribers.length > displayCount;

  if (!visible && !fullScreen) return null;

  if (editPickerVisible) {
    const editResults = editPickerSearch.trim() ? visibleSubscribers.filter(sub =>
      sub.name.includes(editPickerSearch) ||
      (sub.subscriberNumber && sub.subscriberNumber.includes(editPickerSearch)) ||
      (sub.meterNumber && sub.meterNumber.includes(editPickerSearch))
    ) : [];
    return (
      <View style={styles.subscribersOverlay}>
        <View style={styles.subscribersContainer}>
          <View style={styles.subscribersHeader}>
            <TouchableOpacity onPress={() => { setEditPickerVisible(false); setEditPickerSearch(''); }} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
            <Text style={styles.subscribersTitle}>اختر مشترك للتعديل</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
placeholder="اكتب اسم المشترك أو رقم الهاتف أو رقم الجوزة للبحث..."
                placeholderTextColor="#999"
                value={editPickerSearch}
                onChangeText={setEditPickerSearch}
                textAlign="right"
                autoFocus
              />
            </View>
            {editPickerSearch.trim() === '' && (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={80} color="#90A4AE" />
                <Text style={styles.emptyStateText}>اكتب اسم المشترك أو رقم الهاتف أو رقم الجوزة للبحث</Text>
              </View>
            )}
            {editResults.map(sub => (
              <TouchableOpacity
                key={sub.id}
                style={[styles.subscriberCard, styles.unpaidCardBorder, { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }]}
                onPress={() => {
                  setEditPickerVisible(false);
                  setEditPickerSearch('');
                  setEditSubscriber(sub);
                  setEditSubscriberVisible(true);
                }}
              >
                <View style={styles.subscriberInfo}>
                  <Text style={styles.subscriberName}>{sub.name}</Text>
                  <Text style={styles.subscriberAmount}>
                    {sub.amper} أميبر    د.ع {formatNumber(sub.amper * (amperPrices[monthKey] || 0))}
                  </Text>
                  {sub.meterNumber && sub.meterNumber.trim() !== '' ? <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#999', marginTop: IS_SMALL ? 1 : 2 }}>رقم الجوزة: {sub.meterNumber}</Text> : null}
                </View>
                <Ionicons name="chevron-back" size={22} color="#2196F3" />
              </TouchableOpacity>
            ))}
            {editPickerSearch.trim() !== '' && editResults.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={80} color="#90A4AE" />
                <Text style={styles.emptyStateText}>لا يوجد مشتركين بهذا الاسم</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    );
  }

  const screenContent = (
      <View style={styles.subscribersOverlay}>
        <View style={styles.subscribersContainer}>
        <View style={styles.subscribersHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-forward" size={26} color="white" />
          </TouchableOpacity>
          <Text style={styles.subscribersTitle}>المشتركين</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
          <View style={styles.dateSelectors}>
            <TouchableOpacity style={styles.dateDropdown} onPress={() => setMonthPickerVisible(true)}>
              <Text style={styles.dateDropdownText}>{selectedMonth}</Text>
              <Ionicons name="calendar" size={20} color="#2196F3" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateDropdown} onPress={() => setYearPickerVisible(true)}>
              <Text style={styles.dateDropdownText}>{selectedYear}</Text>
              <Ionicons name="calendar" size={20} color="#2196F3" />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 6 : 8, paddingHorizontal: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 10 : 12 }}>
            <TouchableOpacity
              style={[styles.subscriptionTypeBtn, subscriptionTypeFilter === 'normal' && styles.subscriptionTypeBtnActive, { flex: 1 }]}
              onPress={() => setSubscriptionTypeFilter('normal')}
            >
              <Text style={[styles.subscriptionTypeBtnText, subscriptionTypeFilter === 'normal' && styles.subscriptionTypeBtnTextActive]}>اشتراك عادي</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subscriptionTypeBtn, subscriptionTypeFilter === 'golden' && styles.subscriptionTypeBtnActiveGold, { flex: 1 }]}
              onPress={() => setSubscriptionTypeFilter('golden')}
            >
              <Text style={[styles.subscriptionTypeBtnText, subscriptionTypeFilter === 'golden' && styles.subscriptionTypeBtnTextActiveGold]}>اشتراك ذهبي</Text>
            </TouchableOpacity>
          </View>

          {(() => {
            if (!canChangeAmperPrice) return null;
            const hasGolden = subscribers.some(s => s.subscriptionType === 'golden');
            if (hasGolden) {
              return (
                <View style={{ flexDirection: 'row', gap: IS_SMALL ? 6 : 8 }}>
                  <View style={[styles.priceSection, { flex: 1 }]}>
                    <Text style={styles.priceLabel}>سعر العادي - شهر {selectedMonth}</Text>
                    <TextInput
                      style={styles.priceInput}
                      value={amperPrices[`${selectedMonth}_${selectedYear}`] ? formatNumber(amperPrices[`${selectedMonth}_${selectedYear}`]) : ''}
                      onChangeText={(val) => onSaveAmperPrice(`${selectedMonth}_${selectedYear}`, onlyDigits(val))}
                      keyboardType="numeric"
                      textAlign="center"
                      placeholder="0"
                      placeholderTextColor="#999"
                    />
                  </View>
                  <View style={[styles.priceSection, { flex: 1, borderColor: '#FFD700' }]}>
                    <Text style={[styles.priceLabel, { color: '#FF9800' }]}>سعر الذهبي - شهر {selectedMonth}</Text>
                    <TextInput
                      style={[styles.priceInput, { color: '#FF9800' }]}
                      value={goldenPrices && goldenPrices[`${selectedMonth}_${selectedYear}`] ? formatNumber(goldenPrices[`${selectedMonth}_${selectedYear}`]) : ''}
                      onChangeText={(val) => onSaveGoldenPrice(`${selectedMonth}_${selectedYear}`, onlyDigits(val))}
                      keyboardType="numeric"
                      textAlign="center"
                      placeholder="0"
                      placeholderTextColor="#999"
                    />
                  </View>
                </View>
              );
            }
            return (
              <View style={styles.priceSection}>
                <Text style={styles.priceLabel}>سعر الأميبر - شهر {selectedMonth} (د.ع)</Text>
                <TextInput
                  style={styles.priceInput}
                  value={amperPrices[`${selectedMonth}_${selectedYear}`] ? formatNumber(amperPrices[`${selectedMonth}_${selectedYear}`]) : ''}
                  onChangeText={(val) => onSaveAmperPrice(`${selectedMonth}_${selectedYear}`, onlyDigits(val))}
                  keyboardType="numeric"
                  textAlign="center"
                  placeholder="0"
                  placeholderTextColor="#999"
                />
              </View>
            );
          })()}

          <View style={styles.subscriberButtonsRow}>
            <TouchableOpacity style={[styles.deleteSubscriberButtonHalf, { backgroundColor: '#9C27B0' }]} onPress={() => {
              if (onOpenMultiMonthPayment) onOpenMultiMonthPayment();
            }}>
              <Text style={[styles.deleteSubscriberText, { color: 'white' }]}>دفع لأكثر من شهر</Text>
            </TouchableOpacity>
            {canEdit && (
              <TouchableOpacity style={[styles.addSubscriberButtonHalf, { backgroundColor: '#009688' }]} onPress={() => {
                if (filteredSubscribers.length === 0) {
                  showNotification('warning', 'تنبيه', 'لا يوجد مشتركين لتعديلهم');
                  return;
                }
                setEditPickerSearch('');
                setEditPickerVisible(true);
              }}>
                <Text style={[styles.addSubscriberText, { fontSize: IS_SMALL ? 12 : 13 }]}>تعديل بيانات المشترك</Text>
              </TouchableOpacity>
            )}
            {canAdd && (
              <TouchableOpacity style={styles.addSubscriberButtonHalf} onPress={() => setAddSubscriberVisible(true)}>
                <Text style={styles.addSubscriberText}>إضافة مشترك</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.searchContainer}>
            <TextInput style={styles.searchInput} placeholder="اكتب اسم المشترك أو رقم الهاتف أو رقم الجوزة للبحث..." placeholderTextColor="#999" value={searchText} onChangeText={setSearchText} textAlign="right" />
          </View>

          <View style={styles.filterTabs}>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabDeleted, activeFilter === 'deleted' && styles.filterTabDeletedActive]}
              onPress={() => setActiveFilter('deleted')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'deleted' && styles.activeFilterTabText]}>
                {'المحذوفين\n'}({filters.find(f => f.id === 'deleted').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabRequired, activeFilter === 'required' && styles.filterTabRequiredActive]}
              onPress={() => setActiveFilter('required')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'required' && styles.activeFilterTabText]}>
                {'المطلوبين\n'}({filters.find(f => f.id === 'required').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabUnpaid, activeFilter === 'unpaid' && styles.filterTabUnpaidActive]}
              onPress={() => setActiveFilter('unpaid')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'unpaid' && styles.activeFilterTabText]}>
                {'غير مدفوع\n'}({filters.find(f => f.id === 'unpaid').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabPaid, activeFilter === 'paid' && styles.filterTabPaidActive]}
              onPress={() => setActiveFilter('paid')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'paid' && styles.activeFilterTabText]}>
                {'مدفوع\n'}({filters.find(f => f.id === 'paid').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabAll, activeFilter === 'all' && styles.filterTabAllActive]}
              onPress={() => setActiveFilter('all')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'all' && styles.activeFilterTabText]}>
                {'الكل\n'}({filters.find(f => f.id === 'all').count})
              </Text>
            </TouchableOpacity>
          </View>

          {activeFilter === 'deleted' ? (
            filteredDeleted.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="trash-outline" size={80} color="#90A4AE" />
                <Text style={styles.emptyStateText}>لا يوجد محذوفين</Text>
              </View>
            ) : (
              filteredDeleted.map((subscriber) => (
                <View key={subscriber.id} style={[styles.subscriberCard, styles.deletedCard]}>
                  <View style={styles.subscriberInfo}>
                    <Text style={styles.subscriberName}>{subscriber.name}</Text>
                    <Text style={styles.subscriberAmount}>
                      د.ع {formatNumber(getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear)) * getPriceForSubscriber(amperPrices, goldenPrices, `${selectedMonth}_${selectedYear}`, subscriber.subscriptionType))}    <Text style={styles.amperBlue}>{getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear))} أميبر</Text>
                    </Text>
                    {subscriber.meterNumber && subscriber.meterNumber.trim() !== '' ? <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#999', marginTop: IS_SMALL ? 1 : 2 }}>رقم الجوزة: {subscriber.meterNumber}</Text> : null}
                  </View>
                  {canEdit && (
                    <TouchableOpacity style={styles.restoreButton} onPress={() => {
                      Alert.alert('استعادة المشترك', `هل تريد بالتأكيد التراجع عن حذف "${subscriber.name}"؟`, [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'نعم', onPress: () => onRestoreSubscriber(subscriber.id) },
                      ]);
                    }}>
                      <Ionicons name="refresh" size={22} color="#4CAF50" />
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )
          ) : filteredSubscribers.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="mail-open-outline" size={80} color="#2196F3" />
              <Text style={styles.emptyStateText}>لا يوجد مشتركين</Text>
            </View>
          ) : (
            paginatedSubscribers.map((subscriber, subIdx) => {
              const monthKey = `${selectedMonth}_${selectedYear}`;
              const currentAmper = getAmperForMonth(subscriber, selectedMonth, selectedYear);
              const historyForMonth = (subscriber.paymentHistory || []).filter(h => h.monthKey === monthKey);
              const hasMultipleActions = historyForMonth.length > 1;
              const isExpanded = expandedCard === subscriber.id;
          const price = getPriceForSubscriber(amperPrices, goldenPrices, monthKey, subscriber.subscriptionType);
              const calculatedDue = currentAmper * price;
              const paidAmount = subscriber.paidMonths && subscriber.paidMonths[monthKey];
              const totalDue = (paidAmount && typeof paidAmount === 'number') ? paidAmount : calculatedDue;
              const partialPayments = (subscriber.partialPayments && subscriber.partialPayments[monthKey]) || [];
              const totalPartialPaid = partialPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
              const hasPartialPayments = partialPayments.length > 0;
              const hasAnyHistory = historyForMonth.length > 0 || hasPartialPayments;
              const isFullyPaid = isPaid(subscriber);

              return (
                <View key={subscriber.id}>
                  <TouchableOpacity activeOpacity={0.9} delayLongPress={800} onLongPress={() => {
                    if (!canDelete) {
                      showNotification('warning', 'تنبيه', 'لا تملك صلاحية حذف المشترك');
                      return;
                    }
                    Alert.alert('حذف مشترك', `هل تريد حذف "${subscriber.name}"؟\n\nسيتم إزالته من قائمة المشتركين النشطين.\nسيبقى ظاهراً في تقارير الأشهر السابقة.`, [
                      { text: 'إلغاء', style: 'cancel' },
                      { text: 'نعم', onPress: () => onDeleteSubscriber(subscriber.id, monthKey), style: 'destructive' },
                    ]);
                  }}>
                  <View style={[styles.subscriberCard, isFullyPaid ? styles.paidCardBorder : styles.unpaidCardBorder]}>
                    <View style={styles.cardTopRow}>
                      {(isFullyPaid || !hasPartialPayments) && (
                      <TouchableOpacity style={styles.payCheckbox} onPress={() => {
                        setExpandedCard(null);
                        if (!price || price === 0) {
                          showNotification('warning', 'تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                          return;
                        }
                        if (isFullyPaid) {
                          if (!canCancelPayment) {
                            showNotification('warning', 'تنبيه', 'لا تملك صلاحية إلغاء الدفع');
                            return;
                          }
                          Alert.alert('إلغاء التسديد', `هل تريد إلغاء تسديد اشتراك "${subscriber.name}"؟`, [
                            { text: 'إلغاء', style: 'cancel' },
                            { text: 'نعم', onPress: () => onTogglePaid(subscriber.id, monthKey) },
                          ]);
                        } else {
                          if (!canEdit) {
                            showNotification('warning', 'تنبيه', 'لا تملك صلاحية تسديد الاشتراك');
                            return;
                          }
                          Alert.alert('تسديد الاشتراك', `هل تريد تسديد اشتراك "${subscriber.name}"؟`, [
                            { text: 'إلغاء', style: 'cancel' },
                            { text: 'نعم', onPress: () => onTogglePaid(subscriber.id, monthKey) },
                          ]);
                        }
                      }}>
                        {isFullyPaid ? (
                          <View style={styles.checkboxPaid}>
                            <Ionicons name="checkmark-circle" size={36} color="#4CAF50" />
                          </View>
                        ) : (
                          <View style={styles.checkboxUnpaid} />
                        )}
                      </TouchableOpacity>
                      )}
                      <View style={styles.cardNameSection}>
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6 }}>
                            <Text style={styles.subscriberName}>{subscriber.name}</Text>
                            {subscriber.subscriptionType === 'golden' ? <View style={styles.goldenBadge}><Text style={styles.goldenBadgeText}>ذهبي</Text></View> : null}
                          </View>
                          {subscriber.rejectedPayments && subscriber.rejectedPayments[monthKey] ? (
                            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 3, backgroundColor: '#FFF3E0', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Ionicons name="close-circle" size={12} color="#F44336" />
                              <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#F44336', fontWeight: 'bold' }}>تم إلغاء الدفع بواسطة {subscriber.rejectedPayments[monthKey].ownerName}</Text>
                            </View>
                          ) : null}
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 8, marginTop: IS_SMALL ? 1 : 2 }}>
                              <TouchableOpacity
                                onLongPress={() => {
                                  if (!canChangeAmperPrice) {
                                    showNotification('warning', 'تنبيه', 'لا تملك صلاحية تغيير الأمبير');
                                    return;
                                  }
                                  setChangeAmperSubscriber(subscriber);
                                  setChangeAmperVisible(true);
                                }}
                                disabled={!canChangeAmperPrice}
                              >
                                <Text style={[styles.subscriberAmperTag]}>{currentAmper} أميبر</Text>
                              </TouchableOpacity>
                          {subscriber.meterNumber && subscriber.meterNumber.trim() !== '' ? <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#999' }}>رقم الجوزة: {subscriber.meterNumber}</Text> : null}
                        </View>
                      </View>
                      <View style={styles.cardPriceSection}>
                        <Text style={styles.cardPrice}>د.ع {formatNumber(totalDue)}</Text>
                        {!isFullyPaid && !hasPartialPayments && canPartialPayment && (
                          <TouchableOpacity
                            style={styles.partialPayButton}
                            onPress={() => {
                              setExpandedCard(null);
                              if (!price || price === 0) {
                                showNotification('warning', 'تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                                return;
                              }
                              if (onOpenPartialPayment) onOpenPartialPayment(subscriber, monthKey);
                            }}
                          >
                            <Text style={styles.partialPayButtonText}>دفع جزئي</Text>
                          </TouchableOpacity>
                        )}
                        {!isFullyPaid && hasPartialPayments && canPartialPayment && (
                          <TouchableOpacity
                            style={styles.partialPayButton}
                            onPress={() => {
                              setExpandedCard(null);
                              if (!price || price === 0) {
                                showNotification('warning', 'تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                                return;
                              }
                              if (onOpenPartialPayment) onOpenPartialPayment(subscriber, monthKey);
                            }}
                          >
                            <Text style={styles.partialPayButtonText}>أكمال المتبقي</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {hasPartialPayments && !isFullyPaid && (
                      <View style={styles.cardPartialRow}>
                        <View style={styles.partialBadgePaid}>
                          <Text style={styles.partialBadgeLabel}>الواصل</Text>
                          <Text style={styles.partialBadgeValue}>د.ع {formatNumber(totalPartialPaid)}</Text>
                        </View>
                        <View style={styles.partialBadgeRemaining}>
                          <Text style={styles.partialBadgeLabel}>المتبقي</Text>
                          <Text style={styles.partialBadgeValue}>د.ع {formatNumber(totalDue - totalPartialPaid)}</Text>
                        </View>
                      </View>
                    )}

                    {(isFullyPaid || historyForMonth.length > 0 || hasPartialPayments) && (
                      <View style={styles.cardBottomRow}>
                        <View style={styles.cardBottomLeft}>
                          {hasPartialPayments && !isFullyPaid && partialPayments.length > 0 ? (
                            partialPayments[partialPayments.length - 1].ownerName ? (
                              <Text style={styles.paymentOwnerText}>{partialPayments[partialPayments.length - 1].ownerName}</Text>
                            ) : null
                          ) : historyForMonth.length > 0 && historyForMonth[historyForMonth.length - 1].ownerName ? (
                            <Text style={styles.paymentOwnerText}>{historyForMonth[historyForMonth.length - 1].ownerName}</Text>
                          ) : null}
                        </View>
                        {hasAnyHistory && (
                          <TouchableOpacity
                            style={styles.expandButton}
                            onPress={() => setExpandedCard(isExpanded ? null : subscriber.id)}
                          >
                            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color="#999" />
                          </TouchableOpacity>
                        )}
                        <View style={styles.cardBottomRight}>
                          <Text style={styles.paymentDateText}>
                            {hasPartialPayments && !isFullyPaid && partialPayments.length > 0
                              ? partialPayments[partialPayments.length - 1].timestamp
                              : historyForMonth.length > 0 ? historyForMonth[historyForMonth.length - 1].timestamp : 'مدفوع'}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                  {(isExpanded) && (
                    <View style={styles.historyContainer}>
                      {hasPartialPayments && (
                        <View style={styles.partialHistorySection}>
                          <View style={styles.partialHistoryHeader}>
                            <Ionicons name="wallet" size={18} color="#FF9800" />
                            <Text style={styles.partialHistoryTitle}>سجل الدفعات الجزئية</Text>
                          </View>
                          {partialPayments.map((entry, index) => (
                            <View key={`partial-${index}`} style={styles.historyItem}>
                              <View style={[styles.historyDot, styles.historyDotPartial]} />
                              <View style={styles.historyTextContainer}>
                                <Text style={[styles.historyAction, styles.historyActionPartial]}>
                                  دفعة جزئية: د.ع {formatNumber(entry.amount)}
                                </Text>
                                <Text style={styles.historyTimestamp}>{entry.timestamp}</Text>
                                {entry.ownerName ? <Text style={styles.historyTimestamp}>{entry.ownerName}</Text> : null}
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                      {hasAnyHistory && (
                        <View style={styles.paymentHistorySection}>
                          <View style={styles.partialHistoryHeader}>
                            <Ionicons name="time" size={18} color="#2196F3" />
                            <Text style={styles.partialHistoryTitle}>سجل التسديد</Text>
                          </View>
                          {historyForMonth.map((entry, index) => (
                            <View key={index} style={styles.historyItem}>
                              <View style={[
                                styles.historyDot,
                                entry.action === 'paid' ? styles.historyDotPaid : styles.historyDotCancelled
                              ]} />
                              <View style={styles.historyTextContainer}>
                                <Text style={[
                                  styles.historyAction,
                                  entry.action === 'paid' ? styles.historyActionPaid : styles.historyActionCancelled
                                ]}>
                                  {entry.action === 'paid' ? 'تم الدفع' : 'تم إلغاء الدفع'}
                                </Text>
                                <Text style={styles.historyTimestamp}>{entry.timestamp}</Text>
                                {entry.ownerName ? <Text style={styles.historyTimestamp}>{entry.ownerName}</Text> : null}
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  </TouchableOpacity>
                </View>
              );
            })
          )}
          {hasMore && activeFilter !== 'deleted' && (
            <TouchableOpacity style={styles.loadMoreButton} onPress={() => setDisplayCount(prev => prev + PAGE_SIZE)}>
              <Text style={styles.loadMoreText}>عرض المزيد ({filteredSubscribers.length - displayCount} متبقي)</Text>
              <Ionicons name="chevron-down" size={20} color="#2196F3" />
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      <AddSubscriberModal
        visible={addSubscriberVisible}
        onClose={() => setAddSubscriberVisible(false)}
        onSave={(subscriber) => onSaveSubscriber(subscriber)}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        defaultSubscriptionType={subscriptionTypeFilter}
      />

      <MonthPickerModal visible={monthPickerVisible} onClose={() => setMonthPickerVisible(false)} onSelect={setSelectedMonth} selectedMonth={selectedMonth} />
      <YearPickerModal visible={yearPickerVisible} onClose={() => setYearPickerVisible(false)} onSelect={setSelectedYear} selectedYear={selectedYear} />

      <ChangeAmperModal
        visible={changeAmperVisible}
        onClose={() => { setChangeAmperVisible(false); setChangeAmperSubscriber(null); }}
        subscriber={changeAmperSubscriber}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        onConfirm={(newAmper, changeMonth, changeYear) => onChangeAmper(changeAmperSubscriber.id, newAmper, `${changeMonth}_${changeYear}`)}
        amperPrices={amperPrices}
        onSaveAmperPrice={onSaveAmperPrice}
      />

      <EditSubscriberModal
        visible={editSubscriberVisible}
        onClose={() => { setEditSubscriberVisible(false); setEditSubscriber(null); setEditPickerVisible(true); setEditPickerSearch(''); }}
        subscriber={editSubscriber}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        onSave={(updated) => onSaveSubscriber(updated)}
        isPaid={editSubscriber ? isPaid(editSubscriber) : false}
      />

      {deletePickerVisible && (
        <View style={styles.addSubscriberOverlay}>
          <View style={styles.addSubscriberModalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setDeletePickerVisible(false); setDeletePickerSearch(''); }}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{deletePickerMode === 'multiMonth' ? 'اختر مشترك للدفع لأكثر من شهر' : 'اختر مشترك للحذف'}</Text>
              <View style={{ width: 30 }} />
            </View>
            <View style={{ paddingHorizontal: IS_SMALL ? 12 : 16, paddingVertical: IS_SMALL ? 8 : 10 }}>
              <TextInput
                style={[styles.formInput, { textAlign: 'right' }]}
                placeholder="ابحث عن مشترك..."
                placeholderTextColor="#999"
                value={deletePickerSearch}
                onChangeText={setDeletePickerSearch}
              />
            </View>
            <ScrollView style={{ maxHeight: IS_SMALL ? 350 : 400 }} showsVerticalScrollIndicator={false}>
              {visibleSubscribers.filter(sub =>
                sub.name.includes(deletePickerSearch) ||
                (sub.subscriberNumber && sub.subscriberNumber.includes(deletePickerSearch)) ||
                (sub.meterNumber && sub.meterNumber.includes(deletePickerSearch))
              ).map(sub => (
                <TouchableOpacity
                  key={sub.id}
                  style={{ padding: IS_SMALL ? 12 : 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}
                  onPress={() => {
                    setDeletePickerVisible(false);
                    setDeletePickerSearch('');
                    if (deletePickerMode === 'multiMonth') {
                      if (onMultiMonthPayment) onMultiMonthPayment(sub);
                    } else {
                      Alert.alert('حذف مشترك', `هل تريد حذف "${sub.name}"؟\n\nسيتم إزالته من قائمة المشتركين النشطين.\nسيبقى ظاهراً في تقارير الأشهر السابقة.`, [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'نعم', onPress: () => onDeleteSubscriber(sub.id, monthKey), style: 'destructive' },
                      ]);
                    }
                  }}
                >
                  <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#333' }}>{sub.name}</Text>
                  <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#D32F2F' }}>{sub.amper} أميبر</Text>
                </TouchableOpacity>
              ))}
              {visibleSubscribers.filter(sub =>
                sub.name.includes(deletePickerSearch) ||
                (sub.subscriberNumber && sub.subscriberNumber.includes(deletePickerSearch)) ||
                (sub.meterNumber && sub.meterNumber.includes(deletePickerSearch))
              ).length === 0 && (
                <View style={{ padding: IS_SMALL ? 16 : 20, alignItems: 'center' }}>
                  <Text style={{ color: '#999', fontSize: IS_SMALL ? 14 : 16 }}>لا يوجد مشتركين</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      </View>
  );

  if (fullScreen) return screenContent;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      {screenContent}
    </Modal>
  );
};

const ReportsScreen = ({ visible, onClose, subscribers, amperPrices, goldenPrices, fullScreen }) => {
  const { showNotification } = useNotification();
  const [searchText, setSearchText] = useState('');
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedSubscriberId, setSelectedSubscriberId] = useState(null);
  const [subscriptionTypeFilter, setSubscriptionTypeFilter] = useState('normal');
  const foundSub = selectedSubscriberId ? subscribers.find(s => s.id === selectedSubscriberId) : null;
  const selectedSubscriber = foundSub || null;
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSearchText('');
      setSelectedSubscriberId(null);
      setSelectedMonth('all');
      setSubscriptionTypeFilter('normal');
    }
  }, [visible]);

  const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  const getPriceForMonth = (m, y, subType) => getPriceForSubscriber(amperPrices, goldenPrices, `${m}_${y}`, subType);

  const filteredSubscribers = useMemo(() => {
    if (!searchText) return [];
    return subscribers.filter(sub => {
      if ((sub.subscriptionType || 'normal') !== subscriptionTypeFilter) return false;
      if (!sub.name.includes(searchText)) return false;
      return true;
    });
  }, [subscribers, searchText, subscriptionTypeFilter]);

  const monthsToShow = selectedMonth === 'all' ? months : [selectedMonth];

  const reportStats = useMemo(() => {
    let totalDue = 0;
    let totalPaid = 0;
    if (selectedSubscriber) {
      const subAddedMonth = selectedSubscriber.addedMonth ? parseInt(selectedSubscriber.addedMonth) : 1;
      const subAddedYear = selectedSubscriber.addedYear ? parseInt(selectedSubscriber.addedYear) : new Date().getFullYear();
      monthsToShow.forEach(m => {
        const isBeforeAdded = (parseInt(selectedYear) < subAddedYear) || (parseInt(selectedYear) === subAddedYear && parseInt(m) < subAddedMonth);
        if (isBeforeAdded) return;
        const monthKey = `${m}_${selectedYear}`;
        const isDeleted = isDeletedForReport(selectedSubscriber, m, selectedYear);
        if (isDeleted) return;
        const subAmper = getAmperForMonth(selectedSubscriber, m, selectedYear);
        const mPrice = getPriceForMonth(m, selectedYear, selectedSubscriber.subscriptionType);
        if (!mPrice || mPrice === 0) return;
        totalDue += subAmper * mPrice;
        if (selectedSubscriber.paidMonths && selectedSubscriber.paidMonths[monthKey]) {
          totalPaid += subAmper * mPrice;
        } else if (selectedSubscriber.partialPayments && selectedSubscriber.partialPayments[monthKey]) {
          const ppSum = selectedSubscriber.partialPayments[monthKey].reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
          totalPaid += ppSum;
        }
      });
    }
    return { totalDue, totalPaid, totalRemaining: totalDue - totalPaid };
  }, [selectedSubscriber, monthsToShow, selectedYear, amperPrices]);

  if (!visible && !fullScreen) return null;

  const screenContent = (<>
      <View style={styles.reportsOverlay}>
        <View style={styles.reportsContainer}>
          <View style={styles.subscribersHeader}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="white" />
            </TouchableOpacity>
            <Text style={styles.subscribersTitle}>التقارير</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.reportsContent} showsVerticalScrollIndicator={false}>
            <View style={styles.reportsSelectors}>
              <TouchableOpacity style={[styles.reportsDropdown, { padding: IS_SMALL ? 10 : 14 }]} onPress={() => setYearPickerVisible(true)}>
                <Text style={[styles.reportsDropdownText, { fontSize: IS_SMALL ? 14 : 16 }]}>{selectedYear}</Text>
                <Ionicons name="calendar" size={IS_SMALL ? 18 : 20} color="#2196F3" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.reportsDropdown, { padding: IS_SMALL ? 10 : 14 }]} onPress={() => setMonthPickerVisible(true)}>
                <Text style={[styles.reportsDropdownText, { fontSize: IS_SMALL ? 14 : 16 }]}>{selectedMonth === 'all' ? 'كل الأشهر' : selectedMonth}</Text>
                <Ionicons name="calendar" size={IS_SMALL ? 18 : 20} color="#2196F3" />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 5 : 8, paddingHorizontal: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 8 : 12 }}>
              <TouchableOpacity
                style={[styles.subscriptionTypeBtn, subscriptionTypeFilter === 'normal' && styles.subscriptionTypeBtnActive, { flex: 1 }]}
                onPress={() => { setSubscriptionTypeFilter('normal'); setSelectedSubscriberId(null); }}
              >
                <Text style={[styles.subscriptionTypeBtnText, { fontSize: IS_SMALL ? 12 : 14 }, subscriptionTypeFilter === 'normal' && styles.subscriptionTypeBtnTextActive]}>اشتراك عادي</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subscriptionTypeBtn, subscriptionTypeFilter === 'golden' && styles.subscriptionTypeBtnActiveGold, { flex: 1 }]}
                onPress={() => { setSubscriptionTypeFilter('golden'); setSelectedSubscriberId(null); }}
              >
                <Text style={[styles.subscriptionTypeBtnText, { fontSize: IS_SMALL ? 12 : 14 }, subscriptionTypeFilter === 'golden' && styles.subscriptionTypeBtnTextActiveGold]}>اشتراك ذهبي</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <TextInput style={styles.searchInput} placeholder="ابحث عن مشترك..." placeholderTextColor="#999" value={searchText} onChangeText={setSearchText} onFocus={() => { setSearchText(''); setSelectedSubscriberId(null); }} textAlign="right" />
            </View>

            {searchText.length > 0 && !selectedSubscriber && (
              <View style={styles.searchResults}>
                {filteredSubscribers.map(sub => (
                  <TouchableOpacity key={sub.id} style={styles.searchResultItem} onPress={() => setSelectedSubscriberId(sub.id)}>
                    <Text style={styles.searchResultName}>{sub.name}</Text>
                    <Text style={styles.searchResultAmper}>{formatNumber(sub.amper)} أميبر</Text>
                  </TouchableOpacity>
                ))}
                {filteredSubscribers.length === 0 && (
                  <Text style={styles.noResults}>لا يوجد نتائج</Text>
                )}
              </View>
            )}

            {selectedSubscriber && (
              <View style={[styles.reportCard, { padding: IS_SMALL ? 12 : 16 }]}>
                <View style={styles.reportSubscriberHeader}>
                  <Text style={[styles.reportSubscriberName, { fontSize: IS_SMALL ? 17 : 22 }]}>{selectedSubscriber.name}</Text>
                  <TouchableOpacity onPress={() => setSelectedSubscriberId(null)}>
                    <Ionicons name="close-circle" size={24} color="#D32F2F" />
                  </TouchableOpacity>
                </View>

                <View style={[styles.reportSummary, { padding: IS_SMALL ? 10 : 16 }]}>
                  <View style={styles.reportSummaryItem}>
                    <Text style={[styles.reportSummaryLabel, { fontSize: IS_SMALL ? 10 : 12 }]}>المبلغ الكلي</Text>
                    <Text style={[styles.reportSummaryValue, { fontSize: IS_SMALL ? 13 : 16 }]}>د.ع {formatNumber(reportStats.totalDue)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={[styles.reportSummaryLabel, { fontSize: IS_SMALL ? 10 : 12 }]}>المدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryPaid, { fontSize: IS_SMALL ? 13 : 16 }]}>د.ع {formatNumber(reportStats.totalPaid)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={[styles.reportSummaryLabel, { fontSize: IS_SMALL ? 10 : 12 }]}>الغير مدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryRemaining, { fontSize: IS_SMALL ? 13 : 16 }]}>د.ع {formatNumber(reportStats.totalRemaining)}</Text>
                  </View>
                </View>

                <View style={styles.reportTableHeader}>
                  <Text style={[styles.reportTableHeaderText, { fontSize: IS_SMALL ? 11 : 13 }]}>الشهر</Text>
                  <Text style={[styles.reportTableHeaderText, { fontSize: IS_SMALL ? 11 : 13 }]}>الأميبر</Text>
                  <Text style={[styles.reportTableHeaderText, { fontSize: IS_SMALL ? 11 : 13 }]}>المبلغ</Text>
                  <Text style={[styles.reportTableHeaderText, { fontSize: IS_SMALL ? 11 : 13 }]}>الحالة</Text>
                  <Text style={[styles.reportTableHeaderText, { fontSize: IS_SMALL ? 11 : 13 }]}>التاريخ</Text>
                </View>

                {monthsToShow.map(m => {
                  const monthKey = `${m}_${selectedYear}`;
                  const subAddedMonth = selectedSubscriber.addedMonth ? parseInt(selectedSubscriber.addedMonth) : 1;
                  const subAddedYear = selectedSubscriber.addedYear ? parseInt(selectedSubscriber.addedYear) : new Date().getFullYear();
                  const isBeforeAdded = (parseInt(selectedYear) < subAddedYear) || (parseInt(selectedYear) === subAddedYear && parseInt(m) < subAddedMonth);

                  if (isBeforeAdded) {
                    return (
                      <View key={m} style={[styles.reportTableRow, { backgroundColor: '#F5F5F5', padding: IS_SMALL ? 8 : 12 }]}>
                        <Text style={[styles.reportTableCell, { color: '#BBB', fontSize: IS_SMALL ? 11 : 13 }]}>{m}/{selectedYear}</Text>
                        <Text style={[styles.reportTableCell, { color: '#BBB', fontSize: IS_SMALL ? 11 : 13 }]}>-</Text>
                        <Text style={[styles.reportTableCell, { color: '#BBB', fontSize: IS_SMALL ? 11 : 13 }]}>-</Text>
                        <View style={[styles.reportStatusBadge, { backgroundColor: '#E0E0E0' }]}>
                          <Text style={[styles.reportStatusText, { color: '#999', fontSize: IS_SMALL ? 10 : 12 }]}>لم يُضَف بعد</Text>
                        </View>
                        <View style={{flex: 1.5}}>
                          <Text style={[styles.reportTableCellSmall, { color: '#BBB', fontSize: IS_SMALL ? 9 : 11 }]}>-</Text>
                        </View>
                      </View>
                    );
                  }

                  const deleted = isDeletedForReport(selectedSubscriber, m, selectedYear);

                  if (deleted) {
                    return (
                      <View key={m} style={[styles.reportTableRow, { backgroundColor: 'rgba(183, 28, 28, 0.15)', borderRadius: 10, padding: IS_SMALL ? 8 : 12, borderLeftWidth: 4, borderLeftColor: '#B71C1C' }]}>
                        <Text style={[styles.reportTableCell, { fontSize: IS_SMALL ? 11 : 13 }]}>{m}/{selectedYear}</Text>
                        <Text style={[styles.reportTableCell, { fontSize: IS_SMALL ? 11 : 13 }]}>-</Text>
                        <Text style={[styles.reportTableCell, { fontSize: IS_SMALL ? 11 : 13 }]}>-</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: IS_SMALL ? 14 : 16 }}>🗑</Text>
                          <View>
                            <Text style={{ color: '#EF5350', fontSize: IS_SMALL ? 12 : 15, fontWeight: 'bold' }}>تم حذف هذا المشترك</Text>
                            <Text style={{ color: '#9CA3AF', fontSize: IS_SMALL ? 10 : 13 }}>بتاريخ {selectedSubscriber.deletedAt || '-'}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  }

                  const isPaid = selectedSubscriber.paidMonths && selectedSubscriber.paidMonths[monthKey];
                  const history = (selectedSubscriber.paymentHistory || []).filter(h => h.monthKey === monthKey);
                  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
                  const rowAmper = getAmperForMonth(selectedSubscriber, m, selectedYear);
                  const rowPrice = getPriceForMonth(m, selectedYear, selectedSubscriber.subscriptionType);
                  const priceNotSet = !rowPrice || rowPrice === 0;
                  const rowPartialPayments = (selectedSubscriber.partialPayments && selectedSubscriber.partialPayments[monthKey]) || [];
                  const rowPartialSum = rowPartialPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
                  const hasRowPartial = rowPartialPayments.length > 0 && !isPaid;

                  return (
                    <View key={m} style={[styles.reportTableRow, priceNotSet ? styles.reportRowUnpaid : (isPaid ? styles.reportRowPaid : styles.reportRowUnpaid), { padding: IS_SMALL ? 8 : 12 }]}>
                      <Text style={[styles.reportTableCell, { fontSize: IS_SMALL ? 11 : 13 }]}>{m}/{selectedYear}</Text>
                      <Text style={[styles.reportTableCell, styles.amperBlue, { fontSize: IS_SMALL ? 11 : 13 }]}>{rowAmper}</Text>
                      <Text style={[styles.reportTableCell, { fontSize: IS_SMALL ? 10 : 13 }]}>{priceNotSet ? 'لم يتم تحديد السعر بعد' : `د.ع ${formatNumber(rowAmper * rowPrice)}`}</Text>
                      {priceNotSet ? null : (
                        <View style={[styles.reportStatusBadge, isPaid ? styles.reportStatusPaid : (hasRowPartial ? styles.reportStatusPartial : styles.reportStatusUnpaid)]}>
                          <Text style={styles.reportStatusText}>{isPaid ? 'مدفوع' : (hasRowPartial ? `جزئي ${formatNumber(rowPartialSum)}` : 'غير مدفوع')}</Text>
                        </View>
                      )}
                      <View style={{flex: 1.5}}>
                        <Text style={styles.reportTableCellSmall}>{lastEntry ? lastEntry.timestamp : '-'}{lastEntry && lastEntry.ownerName ? ' (' + lastEntry.ownerName + ')' : ''}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      <YearPickerModal visible={yearPickerVisible} onClose={() => setYearPickerVisible(false)} onSelect={setSelectedYear} selectedYear={selectedYear} />
      <MonthPickerAllModal visible={monthPickerVisible} onClose={() => setMonthPickerVisible(false)} onSelect={setSelectedMonth} selectedMonth={selectedMonth} />
  </>);

  if (fullScreen) return screenContent;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      {screenContent}
    </Modal>
  );
};

const MonthPickerAllModal = ({ visible, onClose, onSelect, selectedMonth }) => {
  const options = [
    { value: 'all', label: 'كل الأشهر' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
    { value: '5', label: '5' },
    { value: '6', label: '6' },
    { value: '7', label: '7' },
    { value: '8', label: '8' },
    { value: '9', label: '9' },
    { value: '10', label: '10' },
    { value: '11', label: '11' },
    { value: '12', label: '12' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerContent}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>اختر الشهر</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.pickerList}>
            {options.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.pickerItem, selectedMonth === opt.value && styles.pickerItemSelected]}
                onPress={() => { onSelect(opt.value); onClose(); }}
              >
                <Text style={[styles.pickerItemText, selectedMonth === opt.value && styles.pickerItemTextSelected]}>{opt.label}</Text>
                {selectedMonth === opt.value && <Ionicons name="checkmark" size={22} color="#2196F3" />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const AddGeneratorInput = ({ onAdd }) => {
  const { showNotification } = useNotification();
  const [name, setName] = useState('');
  return (
    <View>
      <TextInput
        style={[styles.formInput, { textAlign: 'right', marginBottom: 15 }]}
        placeholder="ادخل اسم المولد"
        placeholderTextColor="#999"
        value={name}
        onChangeText={setName}
      />
      <TouchableOpacity
        style={[styles.addButton, { backgroundColor: '#2196F3', paddingVertical: 14, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }]}
        onPress={() => {
          if (!name.trim()) {
            showNotification('warning', 'تنبيه', 'ادخل اسم المولد');
            return;
          }
          onAdd(name);
        }}
      >
        <Ionicons name="save-outline" size={20} color="white" />
        <Text style={styles.addButtonText}>حفظ</Text>
      </TouchableOpacity>
    </View>
  );
};

const MonthlyDataScreen = ({ visible, onClose, subscribers, amperPrices, goldenPrices, monthlyExpenses, workerExpenses, onSetExpenses }) => {
  const { showNotification } = useNotification();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [subscriptionTypeFilter, setSubscriptionTypeFilter] = useState('normal');
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [addExpenseVisible, setAddExpenseVisible] = useState(false);
  const [addExpenseField, setAddExpenseField] = useState('');
  const [addExpenseLabel, setAddExpenseLabel] = useState('');
  const [addExpenseAmount, setAddExpenseAmount] = useState('');
  const [showWorkerExpenses, setShowWorkerExpenses] = useState(false);

  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  useEffect(() => {
    if (visible) {
      const n = new Date();
      setSelectedYear(String(n.getFullYear()));
      setSelectedMonth(String(n.getMonth() + 1));
      setSubscriptionTypeFilter('normal');
    }
  }, [visible]);

  const m = parseInt(selectedMonth);
  const y = parseInt(selectedYear);
  const monthKey = `${m}_${y}`;

  const isPastMonth = (y < now.getFullYear()) || (y === now.getFullYear() && m < (now.getMonth() + 1));

  const openAddExpense = (field, label) => {
    setAddExpenseField(field);
    setAddExpenseLabel(label);
    setAddExpenseAmount('');
    setAddExpenseVisible(true);
  };

  const handleConfirmAddExpense = () => {
    const clean = addExpenseAmount.replace(/[^0-9]/g, '');
    const addVal = parseInt(clean) || 0;
    if (addVal <= 0) {
      showNotification('error', 'خطأ', 'أدخل مبلغ صحيح');
      return;
    }
    const currentMap = { gas: monthExpenses.gas, oil: monthExpenses.oil, repairs: monthExpenses.repairs, salaries: monthExpenses.salaries };
    const current = parseInt(String(currentMap[addExpenseField]).replace(/[^0-9]/g, '')) || 0;
    const newVal = String(current + addVal);
    const newExpenses = { ...monthlyExpenses, [monthKey]: { ...monthExpenses, [addExpenseField]: newVal } };
    if (onSetExpenses) onSetExpenses(newExpenses);
    setAddExpenseVisible(false);
    showNotification('success', 'تم', 'تم تسجيل الصرفية بنجاح');
  };

  const stats = useMemo(() => {
    let activeCount = 0;
    let deletedCount = 0;
    let totalAmper = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let requiredCount = 0;
    let requiredAmount = 0;
    let totalExpected = 0;
    let totalCollected = 0;
    subscribers.forEach(s => {
      const addedMonth = s.addedMonth ? parseInt(s.addedMonth) : 1;
      const addedYear = s.addedYear ? parseInt(s.addedYear) : new Date().getFullYear();
      const isBeforeAdded = (y < addedYear) || (y === addedYear && m < addedMonth);
      if (isBeforeAdded) return;
      const isDeleted = isDeletedForReport(s, m, y);
      const subAmper = getAmperForMonth(s, m, y);
      if (isDeleted) { deletedCount++; } else { totalAmper += subAmper; }
      const subPrice = getPriceForSubscriber(amperPrices, goldenPrices, monthKey, s.subscriptionType);
      const monthDue = subAmper * subPrice;
      if (!isDeleted) { totalExpected += monthDue; }
      const isPaid = s.paidMonths && s.paidMonths[monthKey];
      const pp = s.partialPayments && s.partialPayments[monthKey];
      if (isPaid) {
        const paidAmt = (typeof isPaid === 'number') ? isPaid : monthDue;
        totalCollected += paidAmt;
      } else if (pp && pp.length > 0) {
        const ppSum = pp.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        totalCollected += ppSum;
        requiredAmount += monthDue - ppSum;
      }
      if ((s.subscriptionType || 'normal') !== subscriptionTypeFilter) return;
      if (isDeleted) return;
      activeCount++;
      if (isPaid) {
        paidCount++;
      } else if (pp && pp.length > 0) {
        requiredCount++;
      } else { unpaidCount++; }
    });
    return { activeCount, deletedCount, totalAmper, paidCount, unpaidCount, requiredCount, requiredAmount, totalExpected, totalCollected };
  }, [subscribers, m, y, monthKey, amperPrices, goldenPrices, subscriptionTypeFilter]);

  const monthExpenses = monthlyExpenses[monthKey] || { gas: '0', oil: '0', repairs: '0', salaries: '0' };
  const monthWorkerExpenses = (workerExpenses && workerExpenses[monthKey]) || [];
  const workerExpensesTotal = monthWorkerExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalExpenses = (parseFloat(monthExpenses.gas) || 0) + (parseFloat(monthExpenses.oil) || 0) + (parseFloat(monthExpenses.repairs) || 0) + (parseFloat(monthExpenses.salaries) || 0) + workerExpensesTotal;
  const netProfit = stats.totalCollected - totalExpenses;

  const years = [];
  for (let yr = now.getFullYear(); yr >= now.getFullYear() - 5; yr--) years.push(String(yr));

  if (!visible) return null;

  return (
    <View style={styles.subscribersOverlay}>
      <View style={styles.subscribersContainer}>
        <View style={styles.subscribersHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-forward" size={26} color="white" />
          </TouchableOpacity>
          <Text style={styles.subscribersTitle}>بيانات كل شهر</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 6 : 10, paddingHorizontal: IS_SMALL ? 12 : 16, paddingVertical: IS_SMALL ? 8 : 12 }}>
              <TouchableOpacity style={[styles.filterTab, { flex: 1 }]} onPress={() => setYearPickerVisible(true)}>
                <Text style={[styles.filterTabText, { color: '#1565C0', fontSize: IS_SMALL ? 12 : 14 }]}>{selectedYear}</Text>
                <Ionicons name="calendar-outline" size={IS_SMALL ? 14 : 16} color="#1565C0" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterTab, { flex: 1 }]} onPress={() => setMonthPickerVisible(true)}>
                <Text style={[styles.filterTabText, { color: '#1565C0', fontSize: IS_SMALL ? 12 : 14 }]}>{m}</Text>
                <Ionicons name="chevron-down" size={IS_SMALL ? 14 : 16} color="#1565C0" />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 5 : 8, paddingHorizontal: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 8 : 12 }}>
              <TouchableOpacity
                style={[styles.subscriptionTypeBtn, subscriptionTypeFilter === 'normal' && styles.subscriptionTypeBtnActive, { flex: 1 }]}
                onPress={() => setSubscriptionTypeFilter('normal')}
              >
                <Text style={[styles.subscriptionTypeBtnText, { fontSize: IS_SMALL ? 12 : 14 }, subscriptionTypeFilter === 'normal' && styles.subscriptionTypeBtnTextActive]}>اشتراك عادي</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subscriptionTypeBtn, subscriptionTypeFilter === 'golden' && styles.subscriptionTypeBtnActiveGold, { flex: 1 }]}
                onPress={() => setSubscriptionTypeFilter('golden')}
              >
                <Text style={[styles.subscriptionTypeBtnText, { fontSize: IS_SMALL ? 12 : 14 }, subscriptionTypeFilter === 'golden' && styles.subscriptionTypeBtnTextActiveGold]}>اشتراك ذهبي</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statsContainer}>
              <View style={[styles.statCard, styles.totalCard]}>
                <Text style={[styles.statNumber, styles.totalNumber]} numberOfLines={1} adjustsFontSizeToFit>{stats.activeCount}</Text>
                <Text style={[styles.statLabel, styles.totalLabel]} numberOfLines={1} adjustsFontSizeToFit>المشتركين</Text>
              </View>
              <View style={[styles.statCard, styles.paidCard]}>
                <Text style={[styles.statNumber, styles.paidNumber]} numberOfLines={1} adjustsFontSizeToFit>{stats.paidCount}</Text>
                <Text style={[styles.statLabel, styles.paidLabel]} numberOfLines={1} adjustsFontSizeToFit>مدفوع</Text>
              </View>
              <View style={[styles.statCard, styles.unpaidCard]}>
                <Text style={[styles.statNumber, styles.unpaidNumber]} numberOfLines={1} adjustsFontSizeToFit>{stats.unpaidCount}</Text>
                <Text style={[styles.statLabel, styles.unpaidLabel]} numberOfLines={1} adjustsFontSizeToFit>غير مدفوع</Text>
              </View>
            </View>
            <View style={styles.statsContainer}>
              <View style={[styles.statCard, styles.requiredCard]}>
                <Text style={[styles.statNumber, styles.requiredNumber]} numberOfLines={1} adjustsFontSizeToFit>{stats.requiredCount}</Text>
                <Text style={[styles.statLabel, styles.requiredLabel]} numberOfLines={1} adjustsFontSizeToFit>المطلوبين</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
                <Text style={[styles.statNumber, { color: '#9C27B0' }]} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(stats.totalAmper)}</Text>
                <Text style={[styles.statLabel, { color: '#9C27B0' }]} numberOfLines={1} adjustsFontSizeToFit>الأمبير</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#FFEBEE' }]}>
                <Text style={[styles.statNumber, { color: '#607D8B' }]} numberOfLines={1} adjustsFontSizeToFit>{stats.deletedCount}</Text>
                <Text style={[styles.statLabel, { color: '#607D8B' }]} numberOfLines={1} adjustsFontSizeToFit>المحذوفين</Text>
              </View>
            </View>

            <View style={{ paddingHorizontal: IS_SMALL ? 12 : 16, marginTop: IS_SMALL ? 12 : 16 }}>
              <View style={{ height: 1, backgroundColor: '#ddd', marginBottom: IS_SMALL ? 8 : 12 }} />

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 10 : 14, padding: IS_SMALL ? 10 : 16, backgroundColor: '#E3F2FD', borderColor: '#1565C0', borderWidth: 1, borderRadius: IS_SMALL ? 6 : 10 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '700', color: '#333' }}>المتوقع</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333', fontWeight: '600' }}>د.ع {formatNumber(stats.totalExpected)}</Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 10 : 14, padding: IS_SMALL ? 10 : 16, backgroundColor: '#E8F5E9', borderColor: '#4CAF50', borderWidth: 1, borderRadius: IS_SMALL ? 6 : 10 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '700', color: '#333' }}>المبلغ المستوفى من المشتركين</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333', fontWeight: '600' }}>د.ع {formatNumber(stats.totalCollected)}</Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 10 : 14, padding: IS_SMALL ? 10 : 16, backgroundColor: '#FFF3E0', borderColor: '#FF9800', borderWidth: 1, borderRadius: IS_SMALL ? 6 : 10 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '700', color: '#333' }}>المطلوبين</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#E65100', fontWeight: '600' }}>د.ع {formatNumber(stats.requiredAmount)}</Text>
              </View>

              <View style={{ height: 1, backgroundColor: '#ddd', marginVertical: IS_SMALL ? 12 : 16 }} />

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 5 : 8, marginBottom: IS_SMALL ? 8 : 12 }}>
                <Ionicons name="receipt" size={IS_SMALL ? 18 : 22} color="#F44336" />
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '700', color: '#333' }}>الصرفيات</Text>
              </View>

              <View style={{ gap: IS_SMALL ? 6 : 10 }}>
                <View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 2 : 4 }}>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>وقود</Text>
                    {isPastMonth && <TouchableOpacity onPress={() => openAddExpense('gas', 'وقود')} style={{ backgroundColor: '#1565C0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: 'white', fontSize: 11, fontWeight: '600' }}>إضافة صرفية</Text></TouchableOpacity>}
                  </View>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5', padding: IS_SMALL ? 10 : 16 }]}>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.gas) || 0)}</Text>
                  </View>
                </View>
                <View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 2 : 4 }}>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>زيت</Text>
                    {isPastMonth && <TouchableOpacity onPress={() => openAddExpense('oil', 'زيت')} style={{ backgroundColor: '#1565C0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: 'white', fontSize: 11, fontWeight: '600' }}>إضافة صرفية</Text></TouchableOpacity>}
                  </View>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5', padding: IS_SMALL ? 10 : 16 }]}>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.oil) || 0)}</Text>
                  </View>
                </View>
                <View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 2 : 4 }}>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>صيانة</Text>
                    {isPastMonth && <TouchableOpacity onPress={() => openAddExpense('repairs', 'صيانة')} style={{ backgroundColor: '#1565C0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: 'white', fontSize: 11, fontWeight: '600' }}>إضافة صرفية</Text></TouchableOpacity>}
                  </View>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5', padding: IS_SMALL ? 10 : 16 }]}>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.repairs) || 0)}</Text>
                  </View>
                </View>
                <View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: IS_SMALL ? 2 : 4 }}>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>رواتب</Text>
                    {isPastMonth && <TouchableOpacity onPress={() => openAddExpense('salaries', 'رواتب')} style={{ backgroundColor: '#1565C0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: 'white', fontSize: 11, fontWeight: '600' }}>إضافة صرفية</Text></TouchableOpacity>}
                  </View>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5', padding: IS_SMALL ? 10 : 16 }]}>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.salaries) || 0)}</Text>
                  </View>
                </View>
                {monthWorkerExpenses.length > 0 && (
                  <View style={{ marginTop: IS_SMALL ? 6 : 8 }}>
                    <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: IS_SMALL ? 8 : 10, backgroundColor: '#FFF8E1', borderRadius: IS_SMALL ? 8 : 10, borderWidth: 1, borderColor: '#FFE082' }} onPress={() => setShowWorkerExpenses(!showWorkerExpenses)}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6 }}>
                        <Ionicons name={showWorkerExpenses ? "chevron-down" : "chevron-back"} size={IS_SMALL ? 16 : 18} color="#FF9800" />
                        <Ionicons name="person" size={IS_SMALL ? 14 : 16} color="#FF9800" />
                        <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#333', fontWeight: 'bold' }}>صرفيات العامل</Text>
                      </View>
                      <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(workerExpensesTotal)}</Text>
                    </TouchableOpacity>
                    {showWorkerExpenses && monthWorkerExpenses.map((e, idx) => (
                      <View key={'we'+idx} style={{ backgroundColor: '#FFF8E1', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 9 : 12, marginTop: IS_SMALL ? 4 : 6, borderWidth: 1, borderColor: '#FFE082', flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6, flex: 1 }}>
                          <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#333', fontWeight: 'bold' }}>{e.type || 'صرفية'}</Text>
                          <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>({e.workerName || 'عامل'})</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: IS_SMALL ? 6 : 8 }}>
                          <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>{e.timestamp || ''}</Text>
                          <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(e.amount || 0)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: IS_SMALL ? 10 : 14, padding: IS_SMALL ? 10 : 14, backgroundColor: '#FFEBEE', borderRadius: IS_SMALL ? 6 : 10 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '700', color: '#333' }}>مجموع الصرفيات</Text>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: '700', color: '#F44336' }}>د.ع {formatNumber(totalExpenses)}</Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: IS_SMALL ? 6 : 10, padding: IS_SMALL ? 10 : 14, backgroundColor: netProfit >= 0 ? '#E8F5E9' : '#FFEBEE', borderRadius: IS_SMALL ? 6 : 10, marginBottom: IS_SMALL ? 4 : 8 }}>
                <Text style={{ fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold', color: '#333' }}>صافي الربح</Text>
                <Text style={{ fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold', color: netProfit >= 0 ? '#4CAF50' : '#F44336' }}>د.ع {formatNumber(netProfit)}</Text>
              </View>
            </View>

            <View style={{ height: IS_SMALL ? 20 : 30 }} />
          </ScrollView>

        {yearPickerVisible && (
          <Modal visible={yearPickerVisible} transparent animationType="fade">
            <TouchableOpacity style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]} activeOpacity={1} onPress={() => setYearPickerVisible(false)}>
              <View style={[styles.partialModalContent, { maxHeight: '50%' }]} onStartShouldSetResponder={() => true}>
                <Text style={styles.modalTitle}>اختر السنة</Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {years.map(yr => (
                    <TouchableOpacity key={yr} style={{ padding: IS_SMALL ? 10 : 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' }} onPress={() => { setSelectedYear(yr); setYearPickerVisible(false); }}>
                      <Text style={{ fontSize: IS_SMALL ? 15 : 18, color: yr === selectedYear ? '#1565C0' : '#333', fontWeight: yr === selectedYear ? 'bold' : 'normal' }}>{yr}</Text>
                      {yr === selectedYear && <Ionicons name="checkmark" size={IS_SMALL ? 18 : 20} color="#1565C0" style={{ marginRight: 8 }} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        )}

        {monthPickerVisible && (
          <Modal visible={monthPickerVisible} transparent animationType="fade">
            <TouchableOpacity style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]} activeOpacity={1} onPress={() => setMonthPickerVisible(false)}>
              <View style={[styles.partialModalContent, { maxHeight: '50%' }]} onStartShouldSetResponder={() => true}>
                <Text style={styles.modalTitle}>اختر الشهر</Text>
                <ScrollView style={{ maxHeight: 350 }}>
                  {monthNames.map((name, idx) => (
                    <TouchableOpacity key={idx + 1} style={{ padding: IS_SMALL ? 10 : 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' }} onPress={() => { setSelectedMonth(String(idx + 1)); setMonthPickerVisible(false); }}>
                      <Text style={{ fontSize: IS_SMALL ? 15 : 18, color: (idx + 1) === m ? '#1565C0' : '#333', fontWeight: (idx + 1) === m ? 'bold' : 'normal' }}>{idx + 1}</Text>
                      {(idx + 1) === m && <Ionicons name="checkmark" size={IS_SMALL ? 18 : 20} color="#1565C0" style={{ marginRight: 8 }} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        )}

        {addExpenseVisible && (
          <Modal visible={addExpenseVisible} transparent animationType="fade">
            <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
              <View style={{ backgroundColor: 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 18 : 24, width: '80%', alignItems: 'center' }}>
                <Text style={{ fontSize: IS_SMALL ? 15 : 18, fontWeight: 'bold', marginBottom: IS_SMALL ? 12 : 16, color: '#333' }}>إضافة مبلغ - {addExpenseLabel}</Text>
                <View style={{ backgroundColor: '#F5F5F5', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 8 : 10, marginBottom: IS_SMALL ? 10 : 12, width: '100%' }}>
                  <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#666', textAlign: 'center' }}>المبلغ الحالي: د.ع {formatNumber(parseFloat(monthExpenses[addExpenseField]) || 0)}</Text>
                </View>
                <TextInput
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, fontSize: IS_SMALL ? 16 : 18, width: '100%', textAlign: 'center', marginBottom: IS_SMALL ? 12 : 16 }}
                  value={addExpenseAmount ? formatNumber(parseInt(addExpenseAmount.replace(/[^0-9]/g, ''))) : ''}
                  onChangeText={(t) => setAddExpenseAmount(t.replace(/[^0-9]/g, ''))}
                  placeholder="المبلغ المضاف"
                  placeholderTextColor="#999"
                  keyboardType="numeric"
                />
                <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 8 : 12, width: '100%' }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, alignItems: 'center' }}
                    onPress={handleConfirmAddExpense}
                  >
                    <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>إدخال</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#eee', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, alignItems: 'center' }}
                    onPress={() => setAddExpenseVisible(false)}
                  >
                    <Text style={{ color: '#666', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>إلغاء</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </View>
  );
};

const GeneratorsScreen = ({ visible, onClose, generators, currentGeneratorId, onSwitchGenerator, onAddGenerator, onDeleteGenerator, subscribers, amperPrices, goldenPrices, monthlyExpenses, workerExpenses, darkMode, currentUser, deletedGenerators, onRestoreGenerator }) => {
  const { showNotification } = useNotification();
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newGenName, setNewGenName] = useState('');
  const [deletePasswordModal, setDeletePasswordModal] = useState(null);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [restorePasswordVisible, setRestorePasswordVisible] = useState(null);
  const [restorePassword, setRestorePassword] = useState('');

  useEffect(() => {
    if (!restorePasswordVisible && !restoreModalVisible && !addModalVisible && !deletePasswordModal) return;
    var handler = BackHandler.addEventListener('hardwareBackPress', function() {
      if (restorePasswordVisible) { setRestorePasswordVisible(null); setRestorePassword(''); return true; }
      if (restoreModalVisible) { setRestoreModalVisible(false); return true; }
      if (addModalVisible) { setAddModalVisible(false); return true; }
      if (deletePasswordModal) { setDeletePasswordModal(null); return true; }
      return false;
    });
    return function() { handler.remove(); };
  }, [restorePasswordVisible, restoreModalVisible, addModalVisible, deletePasswordModal]);

  const getGeneratorStats = (gen) => {
    var subs = gen.subscribers || [];
    var activeSubs = subs.filter(function(s) { return !s.deletedFromMonth; });
    var totalAmper = 0;
    activeSubs.forEach(function(s) { totalAmper += (s.amper || 0); });
    var exp = gen.monthlyExpenses || {};
    var totalExpenses = (parseFloat(exp.gas) || 0) + (parseFloat(exp.oil) || 0) + (parseFloat(exp.repairs) || 0) + (parseFloat(exp.salaries) || 0);
    var workerExp = gen.workerExpenses || {};
    var workerExpensesTotal = 0;
    Object.keys(workerExp).forEach(function(mk) {
      (workerExp[mk] || []).forEach(function(e) { workerExpensesTotal += (parseFloat(e.amount) || 0); });
    });
    return { subscriberCount: activeSubs.length, totalAmper: totalAmper, totalExpenses: totalExpenses, workerExpensesTotal: workerExpensesTotal };
  };

  var totalSubscribers = 0;
  var totalAmperAll = 0;
  (generators || []).forEach(function(gen) {
    var s = getGeneratorStats(gen);
    totalSubscribers += s.subscriberCount;
    totalAmperAll += s.totalAmper;
  });

  var handleAdd = function() {
    if (!newGenName.trim()) {
      showNotification('warning', 'تنبيه', 'ادخل اسم المولد');
      return;
    }
    onAddGenerator(newGenName);
    setNewGenName('');
    setAddModalVisible(false);
  };

  var handleDelete = function(gen) {
    if ((generators || []).length <= 1) {
      showNotification('warning', 'تنبيه', 'لا يمكن حذف المولد الوحيد');
      return;
    }
    Alert.alert('حذف المولد', 'هل أنت متأكد من حذف "' + gen.name + '"؟\nسيتم طلب كلمة المرور للتأكيد.', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: function() { setDeletePasswordModal(gen); } },
    ]);
  };

  var confirmDelete = async function(gen, password) {
    if (!password || !password.trim()) {
      showNotification('warning', 'تنبيه', 'ادخل كلمة المرور');
      return;
    }
    var result = await onDeleteGenerator(gen.id, password);
    if (result === false) {
      showNotification('error', 'خطأ', 'كلمة المرور غير صحيحة');
    } else {
      setDeletePasswordModal(null);
    }
  };

  if (!visible) return null;

  if (restoreModalVisible) {
    return (
      <View style={[styles.mainContainer, darkMode && { backgroundColor: '#121212' }]}>
        <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
        <View style={{ backgroundColor: '#1565C0', paddingTop: IS_SMALL ? 36 : 44, paddingBottom: IS_SMALL ? 12 : 16, paddingHorizontal: 16, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 40 }} />
          <Text style={{ fontSize: IS_SMALL ? 18 : 22, fontWeight: 'bold', color: 'white', textAlign: 'center', flex: 1 }}>استرداد بيانات المولد</Text>
          <TouchableOpacity onPress={function() { setRestoreModalVisible(false); }} style={{ padding: 6 }}>
            <Ionicons name="arrow-forward" size={IS_SMALL ? 22 : 26} color="white" />
          </TouchableOpacity>
        </View>
        <ScrollView style={[styles.scrollView, darkMode && { backgroundColor: '#121212' }]} showsVerticalScrollIndicator={false}>
          {(!deletedGenerators || deletedGenerators.length === 0) ? (
            <View style={{ alignItems: 'center', marginTop: IS_SMALL ? 40 : 60, paddingHorizontal: 30 }}>
              <Ionicons name="refresh-outline" size={60} color="#ccc" />
              <Text style={{ fontSize: IS_SMALL ? 15 : 18, color: '#999', marginTop: IS_SMALL ? 10 : 16, textAlign: 'center' }}>لا توجد مولدات محذوفة</Text>
            </View>
          ) : (
            deletedGenerators.map(function(dg) {
              var daysLeft = Math.max(0, Math.ceil((30 * 24 * 60 * 60 * 1000 - (Date.now() - dg.deletedAt)) / (24 * 60 * 60 * 1000)));
              var dgData = dg.data || {};
              var subCount = (dgData.subscribers || []).length;
              return (
                <TouchableOpacity key={dg.id} style={{ marginHorizontal: IS_SMALL ? 12 : 16, marginBottom: IS_SMALL ? 10 : 12, backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: IS_SMALL ? 10 : 14, borderWidth: 1, borderColor: darkMode ? '#333' : '#eee', padding: IS_SMALL ? 12 : 16, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }} onPress={function() {
                  setRestorePasswordVisible(dg);
                  setRestorePassword('');
                  setRestoreModalVisible(false);
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: IS_SMALL ? 15 : 17, fontWeight: 'bold', color: darkMode ? '#fff' : '#333' }}>{dg.name}</Text>
                    <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#999', marginTop: 2 }}>{subCount} مشترك - يتبقى {daysLeft} يوم</Text>
                  </View>
                  <Ionicons name="refresh-outline" size={22} color="#4CAF50" />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.mainContainer, darkMode && { backgroundColor: '#121212' }]}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
      <View style={{ backgroundColor: '#1565C0', paddingTop: IS_SMALL ? 36 : 44, paddingBottom: IS_SMALL ? 12 : 16, paddingHorizontal: 16, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={function() { setAddModalVisible(true); setNewGenName(''); }} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: IS_SMALL ? 10 : 14, paddingVertical: IS_SMALL ? 6 : 8 }}>
          <Ionicons name="add-circle" size={IS_SMALL ? 20 : 22} color="white" />
          <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: 'white', fontWeight: 'bold' }}>إضافة مولد</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: IS_SMALL ? 18 : 22, fontWeight: 'bold', color: 'white', textAlign: 'center', flex: 1 }}>المولدات</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
          <Ionicons name="arrow-forward" size={IS_SMALL ? 22 : 26} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView style={[styles.scrollView, darkMode && { backgroundColor: '#121212' }]} showsVerticalScrollIndicator={false}>
        <View style={{ margin: IS_SMALL ? 12 : 16, backgroundColor: '#1565C0', borderRadius: IS_SMALL ? 10 : 14, padding: IS_SMALL ? 14 : 20 }}>
          <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#B3D4FF', fontWeight: '600', marginBottom: IS_SMALL ? 10 : 14, textAlign: 'center' }}>إحصائيات مشتركة</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: IS_SMALL ? 20 : 26, fontWeight: 'bold', color: 'white' }}>{generators ? generators.length : 0}</Text>
              <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#B3D4FF' }}>المولدات</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#4A90D9' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: IS_SMALL ? 20 : 26, fontWeight: 'bold', color: 'white' }}>{totalSubscribers}</Text>
              <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#B3D4FF' }}>مشتركين</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#4A90D9' }} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: IS_SMALL ? 20 : 26, fontWeight: 'bold', color: 'white' }}>{formatNumber(totalAmperAll)}</Text>
              <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#B3D4FF' }}>أميبر</Text>
            </View>
          </View>
        </View>

        {(!generators || generators.length === 0) ? (
          <View style={{ alignItems: 'center', marginTop: IS_SMALL ? 40 : 60, paddingHorizontal: 30 }}>
            <Ionicons name="flash-outline" size={60} color="#ccc" />
            <Text style={{ fontSize: IS_SMALL ? 15 : 18, color: '#999', marginTop: IS_SMALL ? 10 : 16, textAlign: 'center' }}>لا يوجد مولدات بعد</Text>
            <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#bbb', marginTop: 6, textAlign: 'center' }}>اضغط على "إضافة مولد" لإضافة مولد جديد</Text>
          </View>
        ) : (
          generators.map(function(gen) {
            var stats = getGeneratorStats(gen);
            var isCurrent = gen.id === currentGeneratorId;
            return (
              <TouchableOpacity
                key={gen.id}
                style={{
                  marginHorizontal: IS_SMALL ? 12 : 16,
                  marginBottom: IS_SMALL ? 10 : 12,
                  backgroundColor: darkMode ? '#1e1e1e' : 'white',
                  borderRadius: IS_SMALL ? 10 : 14,
                  borderLeftWidth: isCurrent ? 4 : 0,
                  borderLeftColor: isCurrent ? '#2196F3' : 'transparent',
                  borderWidth: isCurrent ? 2 : 1,
                  borderColor: isCurrent ? '#2196F3' : (darkMode ? '#333' : '#eee'),
                  padding: IS_SMALL ? 12 : 16,
                  elevation: isCurrent ? 4 : 2,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: isCurrent ? 0.15 : 0.08,
                  shadowRadius: 4,
                  flexDirection: 'row-reverse',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onPress={function() { if (!isCurrent) { onSwitchGenerator(gen.id); } }}
                activeOpacity={isCurrent ? 1 : 0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: IS_SMALL ? 6 : 8 }}>
                    <Ionicons name="flash" size={IS_SMALL ? 18 : 22} color={isCurrent ? '#2196F3' : '#999'} />
                    <Text style={{ fontSize: IS_SMALL ? 15 : 17, fontWeight: isCurrent ? 'bold' : '600', color: darkMode ? '#fff' : '#333', flex: 1, textAlign: 'center' }}>{gen.name}</Text>
                    <View style={{ backgroundColor: isCurrent ? '#E3F2FD' : 'transparent', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, minWidth: 48, alignItems: 'center' }}>
                      {isCurrent ? <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#1565C0', fontWeight: '600' }}>الحالي</Text> : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: IS_SMALL ? 8 : 12, marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="people-outline" size={IS_SMALL ? 13 : 15} color="#666" />
                      <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>{stats.subscriberCount} مشترك</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="flash-outline" size={IS_SMALL ? 13 : 15} color="#FF9800" />
                      <Text style={{ fontSize: IS_SMALL ? 11 : 13, color: '#666' }}>{formatNumber(stats.totalAmper)} أميبر</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={function() { handleDelete(gen); }}
                  style={{ padding: IS_SMALL ? 6 : 8, marginLeft: 8 }}
                >
                  <Ionicons name="trash-outline" size={IS_SMALL ? 18 : 22} color="#F44336" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}

        {deletedGenerators && deletedGenerators.length > 0 && (
          <TouchableOpacity
            onPress={function() { setRestoreModalVisible(true); }}
            style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: IS_SMALL ? 4 : 6, marginHorizontal: IS_SMALL ? 12 : 16, marginTop: IS_SMALL ? 6 : 8, paddingVertical: IS_SMALL ? 6 : 8 }}
          >
            <Ionicons name="refresh-outline" size={IS_SMALL ? 14 : 16} color="#999" />
            <Text style={{ fontSize: IS_SMALL ? 12 : 13, color: '#999' }}>استرداد بيانات المولد ({deletedGenerators.length})</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: IS_SMALL ? 20 : 30 }} />
      </ScrollView>

      {addModalVisible && (
        <Modal visible={addModalVisible} animationType="fade" transparent>
          <TouchableOpacity style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]} activeOpacity={1} onPress={function() { setAddModalVisible(false); }}>
            <View style={[styles.partialModalContent, { maxHeight: '40%' }]} onStartShouldSetResponder={function() { return true; }}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={function() { setAddModalVisible(false); }}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>إضافة مولد جديد</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={{ padding: IS_SMALL ? 14 : 20 }}>
                <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: darkMode ? '#fff' : '#333', marginBottom: 10, textAlign: 'right' }}>ادخل اسم المولد الجديد</Text>
                <TextInput
                  style={[styles.formInput, { textAlign: 'right', marginBottom: 15 }]}
                  placeholder="ادخل اسم المولد"
                  placeholderTextColor="#999"
                  value={newGenName}
                  onChangeText={setNewGenName}
                />
                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: '#2196F3', paddingVertical: 14, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }]}
                  onPress={handleAdd}
                >
                  <Ionicons name="save-outline" size={20} color="white" />
                  <Text style={[styles.addButtonText, { color: 'white' }]}>حفظ</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {deletePasswordModal && (
        <Modal visible={!!deletePasswordModal} animationType="fade" transparent>
          <TouchableOpacity style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]} activeOpacity={1} onPress={function() { setDeletePasswordModal(null); }}>
            <DeletePasswordModal
              gen={deletePasswordModal}
              onConfirm={confirmDelete}
              onCancel={function() { setDeletePasswordModal(null); }}
              darkMode={darkMode}
            />
          </TouchableOpacity>
        </Modal>
      )}

      {restorePasswordVisible && (
        <Modal visible={!!restorePasswordVisible} animationType="fade" transparent>
          <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
            <View style={[styles.partialModalContent, { width: MODAL_WIDTH, maxHeight: '40%' }]} onStartShouldSetResponder={function() { return true; }}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={function() { setRestorePasswordVisible(null); }}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>استرداد "{restorePasswordVisible.name}"</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={{ padding: IS_SMALL ? 14 : 20 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333', marginBottom: 10, textAlign: 'right' }}>ادخل كلمة المرور للتأكيد</Text>
                <TextInput
                  style={[styles.formInput, { textAlign: 'right', marginBottom: 15 }]}
                  placeholder="كلمة المرور"
                  placeholderTextColor="#999"
                  value={restorePassword}
                  onChangeText={setRestorePassword}
                  secureTextEntry
                />
                <TouchableOpacity
                  style={{ backgroundColor: '#4CAF50', paddingVertical: 14, borderRadius: 10, alignItems: 'center' }}
                  onPress={async function() {
                    if (!restorePassword || !restorePassword.trim()) {
                      showNotification('warning', 'تنبيه', 'ادخل كلمة المرور');
                      return;
                    }
                    try {
                      var usersResult = await loadFromFile('registered_users');
                      var usersList = usersResult || [];
                      var user = usersList.find(function(u) { return u.phone === currentUser; });
                      if (!user) { showNotification('error', 'خطأ', 'حدث خطأ'); return; }
                      var verifyResult = await verifyOwnerPassword(user.password, restorePassword.trim(), currentUser);
                      if (verifyResult.match) {
                        onRestoreGenerator(restorePasswordVisible.id);
                        setRestorePasswordVisible(null);
                        setRestorePassword('');
                      } else {
                        showNotification('error', 'خطأ', 'كلمة المرور غير صحيحة');
                      }
                    } catch (e) {
                      showNotification('error', 'خطأ', 'حدث خطأ أثناء التحقق');
                    }
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>تأكيد الاسترداد</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const DeletePasswordModal = ({ gen, onConfirm, onCancel, darkMode }) => {
  const [password, setPassword] = useState('');
  return (
    <View style={[styles.partialModalContent, { maxHeight: '35%' }]} onStartShouldSetResponder={function() { return true; }}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onCancel}>
          <Ionicons name="close" size={28} color="#333" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>حذف "{gen.name}"</Text>
        <View style={{ width: 28 }} />
      </View>
      <View style={{ padding: IS_SMALL ? 14 : 20 }}>
        <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#fff' : '#333', marginBottom: 10, textAlign: 'right' }}>ادخل كلمة المرور للتأكيد</Text>
        <TextInput
          style={[styles.formInput, { textAlign: 'right', marginBottom: 15 }]}
          placeholder="كلمة المرور"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity
          style={{ backgroundColor: '#F44336', paddingVertical: 14, borderRadius: 10, alignItems: 'center' }}
          onPress={function() { onConfirm(gen, password); }}
        >
          <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>تأكيد الحذف</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const MainScreen = ({ currentUser, generatorName, onOpenSettings, onShowSubscribers, onShowReports, subscribers, amperPrices, onSetAmperPrice, goldenPrices, onSetGoldenPrice, expenses, workerExpenses, onSetExpenses, onLogout, isOnline, generators, onShowMonthlyData, darkMode, pendingUpdatesCount, onShowWorkerTracking, workers, onDeleteWorkerExpense, subscriptionData }) => {
  const theme = darkMode ? { bg: '#121212', card: '#1e1e1e', text: '#fff', subText: '#aaa', border: '#333' } : { bg: '#f5f5f5', card: 'white', text: '#333', subText: '#666', border: '#ddd' };
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;

  const [localAmperPrice, setLocalAmperPrice] = useState(amperPrices[currentMonthKey] ? String(amperPrices[currentMonthKey]) : '');
  const [localGoldenPrice, setLocalGoldenPrice] = useState(goldenPrices[currentMonthKey] ? String(goldenPrices[currentMonthKey]) : '');
  const [gas, setGas] = useState(expenses.gas || '');
  const [oil, setOil] = useState(expenses.oil || '');
  const [repairs, setRepairs] = useState(expenses.repairs || '');
  const [salaries, setSalaries] = useState(expenses.salaries || '');
  const [addExpenseVisible, setAddExpenseVisible] = useState(false);
  const [showWorkerExpenses, setShowWorkerExpenses] = useState(false);
  const [addExpenseField, setAddExpenseField] = useState(null);
  const [addExpenseAmount, setAddExpenseAmount] = useState('');
  const [addExpenseLabel, setAddExpenseLabel] = useState('');

  const hasGoldenSubscribers = useMemo(() => subscribers.some(s => s.subscriptionType === 'golden' && !isDeletedForReport(s, currentMonth, currentYear)), [subscribers, currentMonth, currentYear]);

  useEffect(() => {
    setLocalAmperPrice(String(amperPrices[currentMonthKey] || ''));
    setLocalGoldenPrice(String(goldenPrices[currentMonthKey] || ''));
    setGas(expenses.gas);
    setOil(expenses.oil);
    setRepairs(expenses.repairs);
    setSalaries(expenses.salaries);
  }, [amperPrices, goldenPrices, expenses]);

  const stats = useMemo(() => {
    const price = parseFloat(localAmperPrice) || 0;
    const gPrice = parseFloat(localGoldenPrice) || 0;
    let totalAmper = 0;
    let paidCount = 0;
    let requiredCount = 0;
    let unpaidCount = 0;
    let collectedAmount = 0;
    let visibleCount = 0;
    subscribers.forEach(s => {
      const addedMonth = s.addedMonth ? parseInt(s.addedMonth) : 1;
      const addedYear = s.addedYear ? parseInt(s.addedYear) : currentYear;
      const isBeforeAdded = (currentYear < addedYear) || (currentYear === addedYear && currentMonth < addedMonth);
      if (isBeforeAdded) return;
      if (isDeletedForReport(s, currentMonth, currentYear)) return;
      visibleCount++;
      const amp = getAmperForMonth(s, currentMonth, currentYear);
      totalAmper += amp;
      const subPrice = s.subscriptionType === 'golden' ? gPrice : price;
      const isPaid = s.paidMonths && s.paidMonths[currentMonthKey];
      const pp = s.partialPayments && s.partialPayments[currentMonthKey];
      const hasPartial = pp && pp.length > 0;
      if (isPaid) {
        paidCount++;
        collectedAmount += (typeof isPaid === 'number') ? isPaid : (amp * subPrice);
      } else if (hasPartial) {
        requiredCount++;
        const ppSum = pp.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
        collectedAmount += ppSum;
      } else {
        unpaidCount++;
      }
    });
    const expectedAmount = totalAmper * price + subscribers.filter(s => {
      if (s.subscriptionType !== 'golden') return false;
      const addedMonth = s.addedMonth ? parseInt(s.addedMonth) : 1;
      const addedYear = s.addedYear ? parseInt(s.addedYear) : currentYear;
      if ((currentYear < addedYear) || (currentYear === addedYear && currentMonth < addedMonth)) return false;
      if (isDeletedForReport(s, currentMonth, currentYear)) return false;
      return true;
    }).reduce((sum, s) => sum + getAmperForMonth(s, currentMonth, currentYear) * gPrice, 0);
    const ownerExpenses = (parseFloat(gas) || 0) + (parseFloat(oil) || 0) +
      (parseFloat(repairs) || 0) + (parseFloat(salaries) || 0);
    const workerExpensesTotal = (workerExpenses || []).reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalExpenses = ownerExpenses + workerExpensesTotal;
    const netExpected = collectedAmount - totalExpenses;
    return { totalSubscribers: visibleCount, totalAmper, paidCount, requiredCount, unpaidCount, collectedAmount, expectedAmount, totalExpenses, workerExpensesTotal, netExpected, price };
  }, [subscribers, localAmperPrice, localGoldenPrice, gas, oil, repairs, salaries, currentMonth, currentYear, currentMonthKey, workerExpenses]);

  const { totalSubscribers, totalAmper, paidCount, requiredCount, unpaidCount, collectedAmount, expectedAmount, totalExpenses, workerExpensesTotal, netExpected, price } = stats;

  const getCurrentDate = () => {
    const now = new Date();
    return `${now.getMonth() + 1} / ${now.getFullYear()}`;
  };

  const handleAmperPriceChange = (val) => {
    const clean = onlyDigits(val);
    setLocalAmperPrice(clean);
    onSetAmperPrice(currentMonthKey, clean);
  };

  const handleGoldenPriceChange = (val) => {
    const clean = onlyDigits(val);
    setLocalGoldenPrice(clean);
    onSetGoldenPrice(currentMonthKey, clean);
  };

  const handleExpenseChange = (field, val) => {
    const clean = onlyDigits(val);
    const newExpenses = { gas, oil, repairs, salaries, [field]: clean };
    if (field === 'gas') setGas(clean);
    if (field === 'oil') setOil(clean);
    if (field === 'repairs') setRepairs(clean);
    if (field === 'salaries') setSalaries(clean);
    onSetExpenses(newExpenses);
  };

  const openAddExpense = (field, label) => {
    setAddExpenseField(field);
    setAddExpenseLabel(label);
    setAddExpenseAmount('');
    setAddExpenseVisible(true);
  };

  const handleConfirmAddExpense = () => {
    const addVal = parseInt(onlyDigits(addExpenseAmount)) || 0;
    if (addVal <= 0) {
      Alert.alert('خطأ', 'أدخل مبلغ صحيح');
      return;
    }
    const currentMap = { gas, oil, repairs, salaries };
    const current = parseInt(onlyDigits(currentMap[addExpenseField])) || 0;
    const newVal = String(current + addVal);
    handleExpenseChange(addExpenseField, newVal);
    setAddExpenseVisible(false);
  };

  const handleDeleteWorkerExpense = (expenseIndex) => {
    Alert.alert('حذف صرفية العامل', 'هل تريد بالتأكيد حذف هذه الصرفية؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'نعم', onPress: async () => {
          const mk = `${new Date().getMonth() + 1}_${new Date().getFullYear()}`;
          if (onDeleteWorkerExpense) onDeleteWorkerExpense(mk, expenseIndex);
        }
      }
    ]);
  };

  return (
    <View style={[styles.mainContainer, darkMode && { backgroundColor: '#121212' }]}>
      <StatusBar backgroundColor={isOnline ? "#2196F3" : "#FF5722"} barStyle="light-content" />
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="white" />
          <Text style={styles.offlineBannerText}>لا يوجد اتصال بالإنترنت - البيانات قد لا تُحفظ</Text>
        </View>
      )}
      <TrialBanner subscriptionData={subscriptionData} onPress={() => Alert.alert('اشتراكك', subscriptionData.status === 'trial' ? 'فترة تجربتك تنتهي بعد ' + (subscriptionData.daysLeft || 0) + ' يوم' : 'اشتراكك منتهي')} />
      <ScrollView style={[styles.scrollView, darkMode && { backgroundColor: '#121212' }]} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: IS_SMALL ? 12 : 16, marginTop: IS_SMALL ? 8 : 12, marginBottom: IS_SMALL ? 8 : 12 }}>
          <TouchableOpacity style={styles.monthlyDataButton} onPress={onShowMonthlyData}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
              <Ionicons name="calendar-outline" size={IS_SMALL ? 14 : 16} color="white" />
              <Text style={styles.monthlyDataButtonText}>بيانات كل شهر</Text>
            </View>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <Ionicons name="flash-outline" size={IS_SMALL ? 14 : 16} color="#1565C0" />
            <Text style={[styles.dateText, { fontSize: IS_SMALL ? 12 : 14 }]}>{generatorName || 'مولدي'} - {getCurrentDate()}</Text>
          </View>
        </View>

        {hasGoldenSubscribers ? (
          <View style={{ flexDirection: 'row', gap: IS_SMALL ? 5 : 8 }}>
            <View style={[styles.priceSection, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }, { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 10 }]}>
              <Text style={[styles.priceLabel, darkMode && { color: '#fff' }, { marginBottom: 0, flex: 1, fontSize: IS_SMALL ? 10 : 12 }]}>سعر الاشتراك العادي - شهر {currentMonth}</Text>
              <TextInput style={[styles.priceInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }, { flex: 1 }]} value={localAmperPrice ? formatNumber(localAmperPrice) : ''} onChangeText={handleAmperPriceChange} keyboardType="numeric" textAlign="center" placeholder="0" placeholderTextColor="#999" />
            </View>
            <View style={[styles.priceSection, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }, { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 10, borderColor: '#FFD700' }]}>
              <Text style={[styles.priceLabel, { color: '#FF9800' }, { marginBottom: 0, flex: 1, fontSize: IS_SMALL ? 10 : 12 }]}>سعر الاشتراك الذهبي - شهر {currentMonth}</Text>
              <TextInput style={[styles.priceInput, darkMode && { backgroundColor: '#2a2a2a', color: '#FFD700', borderColor: '#444' }, { flex: 1, color: '#FF9800' }]} value={localGoldenPrice ? formatNumber(localGoldenPrice) : ''} onChangeText={handleGoldenPriceChange} keyboardType="numeric" textAlign="center" placeholder="0" placeholderTextColor="#999" />
            </View>
          </View>
        ) : (
          <View style={[styles.priceSection, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }, { flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 10 }]}>
            <Text style={[styles.priceLabel, darkMode && { color: '#fff' }, { marginBottom: 0, flex: 1 }]}>سعر الأميبر - شهر {currentMonth} (د.ع)</Text>
            <TextInput style={[styles.priceInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }, { flex: 1 }]} value={localAmperPrice ? formatNumber(localAmperPrice) : ''} onChangeText={handleAmperPriceChange} keyboardType="numeric" textAlign="center" placeholder="0" placeholderTextColor="#999" />
          </View>
        )}

        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.totalCard]}>
            <Text style={[styles.statNumber, styles.totalNumber]} numberOfLines={1} adjustsFontSizeToFit>{totalSubscribers}</Text>
            <Text style={[styles.statLabel, styles.totalLabel]} numberOfLines={1} adjustsFontSizeToFit>عدد المشتركين</Text>
          </View>
          <View style={[styles.statCard, styles.amperCard]}>
            <Text style={[styles.statNumber, styles.amperNumber]} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(totalAmper)}</Text>
            <View style={styles.amperLabelContainer}>
              <Text style={[styles.statLabel, styles.amperLabel]} numberOfLines={1} adjustsFontSizeToFit>أميبر</Text>
              <Ionicons name="flash" size={IS_SMALL ? 12 : 14} color="#FF9800" />
            </View>
          </View>
          <View style={[styles.statCard, styles.paidCard]}>
            <Text style={[styles.statNumber, styles.paidNumber]} numberOfLines={1} adjustsFontSizeToFit>{paidCount}</Text>
            <Text style={[styles.statLabel, styles.paidLabel]} numberOfLines={1} adjustsFontSizeToFit>مدفوع</Text>
          </View>
          <View style={[styles.statCard, styles.unpaidCard]}>
            <Text style={[styles.statNumber, styles.unpaidNumber]} numberOfLines={1} adjustsFontSizeToFit>{unpaidCount}</Text>
            <Text style={[styles.statLabel, styles.unpaidLabel]} numberOfLines={1} adjustsFontSizeToFit>غير مدفوع</Text>
          </View>
          <View style={[styles.statCard, styles.requiredCard]}>
            <Text style={[styles.statNumber, styles.requiredNumber]} numberOfLines={1} adjustsFontSizeToFit>{requiredCount}</Text>
            <Text style={[styles.statLabel, styles.requiredLabel]} numberOfLines={1} adjustsFontSizeToFit>المطلوبين</Text>
          </View>
        </View>


        <View style={[styles.financialSummary, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }]}>
          <View style={[styles.summaryRow, { flexDirection: 'row-reverse' }]}>
            <Text style={[styles.summaryLabel, darkMode && { color: '#aaa' }]}>المتوقع:</Text>
            <Text style={[styles.summaryValue, darkMode && { color: '#fff' }]}>د.ع {formatNumber(expectedAmount)}</Text>
          </View>
          <View style={[styles.summaryRow, { flexDirection: 'row-reverse' }]}>
            <Text style={[styles.summaryLabel, darkMode && { color: '#aaa' }]}>المبلغ المستوفى من المشتركين:</Text>
            <Text style={[styles.summaryValue, styles.collectedValue, darkMode && { color: '#4CAF50' }]}>د.ع {formatNumber(collectedAmount)}</Text>
          </View>
        </View>

        <View style={[styles.expensesSection, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }]}>
          <View style={[styles.expensesHeader, { justifyContent: 'space-between', flexDirection: 'row-reverse' }]}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 5 : 8 }}>
              <Ionicons name="wallet-outline" size={IS_SMALL ? 20 : 24} color="#4CAF50" />
              <Text style={[styles.expensesTitle, darkMode && { color: '#fff' }]}>الصرفيات</Text>
            </View>
            {totalExpenses > 0 && (
              <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: '#D32F2F' }}>د.ع {formatNumber(totalExpenses)}</Text>
            )}
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="water" size={IS_SMALL ? 14 : 16} color="#2196F3" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>كاز</Text>
            </View>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={gas ? formatNumber(gas) : ''} onChangeText={(v) => handleExpenseChange('gas', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('gas', 'كاز')}>
              <Ionicons name="add-circle" size={IS_SMALL ? 20 : 24} color="#4CAF50" />
            </TouchableOpacity>
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="flask" size={IS_SMALL ? 14 : 16} color="#9C27B0" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>دهن</Text>
            </View>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={oil ? formatNumber(oil) : ''} onChangeText={(v) => handleExpenseChange('oil', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('oil', 'دهن')}>
              <Ionicons name="add-circle" size={IS_SMALL ? 20 : 24} color="#4CAF50" />
            </TouchableOpacity>
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="build" size={IS_SMALL ? 14 : 16} color="#FF5722" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>إصلاحات</Text>
            </View>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={repairs ? formatNumber(repairs) : ''} onChangeText={(v) => handleExpenseChange('repairs', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('repairs', 'إصلاحات')}>
              <Ionicons name="add-circle" size={IS_SMALL ? 20 : 24} color="#4CAF50" />
            </TouchableOpacity>
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="people" size={IS_SMALL ? 14 : 16} color="#607D8B" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>رواتب</Text>
            </View>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={salaries ? formatNumber(salaries) : ''} onChangeText={(v) => handleExpenseChange('salaries', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('salaries', 'رواتب')}>
              <Ionicons name="add-circle" size={IS_SMALL ? 20 : 24} color="#4CAF50" />
            </TouchableOpacity>
          </View>
          {workerExpenses.length > 0 && (
            <TouchableOpacity style={styles.expenseRow} onPress={() => setShowWorkerExpenses(!showWorkerExpenses)}>
              <Ionicons name={showWorkerExpenses ? "chevron-down" : "chevron-back"} size={IS_SMALL ? 16 : 20} color="#FF9800" />
              <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: '#D32F2F', marginHorizontal: IS_SMALL ? 5 : 8 }}>د.ع {formatNumber(workerExpenses.reduce((s, e) => s + (e.amount || 0), 0))}</Text>
              <View style={[styles.expenseLabelContainer, { flex: 1 }]}>
                <Ionicons name="person" size={16} color="#FF9800" />
                <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>صرفيات العامل</Text>
              </View>
            </TouchableOpacity>
          )}
          {showWorkerExpenses && workerExpenses.map((e, idx) => (
            <View key={'we'+idx} style={{ backgroundColor: '#FFF8E1', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 9 : 12, marginTop: IS_SMALL ? 6 : 8, borderWidth: 1, borderColor: '#FFE082', flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 4 : 6, flex: 1 }}>
                <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#333', fontWeight: 'bold' }}>{e.type}</Text>
                <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>({e.workerName || 'عامل'})</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: IS_SMALL ? 6 : 8 }}>
                <Text style={{ fontSize: IS_SMALL ? 10 : 11, color: '#999' }}>{e.timestamp || ''}</Text>
                <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(e.amount)}</Text>
                <TouchableOpacity onPress={() => handleDeleteWorkerExpense(idx)} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={18} color="#F44336" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.netExpectedContainer, { flexDirection: 'row-reverse' }, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }, netExpected < 0 && styles.netExpectedNegative]}>
          <Text style={[styles.netExpectedLabel, darkMode && { color: '#aaa' }]}>الصافي:</Text>
          <Text style={[styles.netExpectedValue, netExpected < 0 && styles.netExpectedValueNegative]}>
            {netExpected < 0 ? `${formatNumber(Math.abs(netExpected))} - د.ع` : `د.ع ${formatNumber(netExpected)}`}
          </Text>
        </View>

      </ScrollView>

      <Modal visible={addExpenseVisible} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={{ backgroundColor: 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 18 : 24, width: '80%', alignItems: 'center' }}>
            <Text style={{ fontSize: IS_SMALL ? 15 : 18, fontWeight: 'bold', marginBottom: IS_SMALL ? 12 : 16, color: '#333' }}>إضافة مبلغ - {addExpenseLabel}</Text>
            <View style={{ backgroundColor: '#F5F5F5', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 8 : 10, marginBottom: IS_SMALL ? 10 : 12, width: '100%' }}>
              <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#666', textAlign: 'center' }}>المبلغ الحالي: د.ع {formatNumber(parseInt(onlyDigits(addExpenseField === 'gas' ? gas : addExpenseField === 'oil' ? oil : addExpenseField === 'repairs' ? repairs : salaries)) || 0)}</Text>
            </View>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, fontSize: IS_SMALL ? 16 : 18, width: '100%', textAlign: 'center', marginBottom: IS_SMALL ? 12 : 16 }}
              value={addExpenseAmount ? formatNumber(parseInt(onlyDigits(addExpenseAmount))) : ''}
              onChangeText={(t) => setAddExpenseAmount(onlyDigits(t))}
              placeholder="المبلغ المضاف"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
            <View style={{ flexDirection: 'row-reverse', gap: IS_SMALL ? 8 : 12, width: '100%' }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, alignItems: 'center' }}
                onPress={handleConfirmAddExpense}
              >
                <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>إدخال</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#eee', borderRadius: IS_SMALL ? 8 : 10, padding: IS_SMALL ? 10 : 12, alignItems: 'center' }}
                onPress={() => setAddExpenseVisible(false)}
              >
                <Text style={{ color: '#666', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const WorkerMainScreen = ({ generatorName, onShowSubscribers, onShowReports, subscribers, amperPrices, goldenPrices, onLogout, isOnline, workerUpdates, onSync, workerName, generators, workerPermissions, onSwitchGenerator, onShowWorkerSwitchGenerator, workerAssignedGenerators, onAddExpense, darkMode, onShowExpense }) => {
  const { showNotification } = useNotification();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;

  const normalPrice = (amperPrices && amperPrices[currentMonthKey]) || 0;
  const goldenPriceVal = (goldenPrices && goldenPrices[currentMonthKey]) || 0;
  const totalAmper = useMemo(() => {
    let total = 0;
    subscribers.forEach(s => {
      if (isDeletedForReport(s, currentMonth, currentYear)) return;
      total += getAmperForMonth(s, currentMonth, currentYear);
    });
    return total;
  }, [subscribers, currentMonth, currentYear]);

  const { totalSubscribers, paidCount, requiredCount, unpaidCount } = useMemo(() => {
    let ts = 0, pc = 0, rc = 0, uc = 0;
    subscribers.forEach(s => {
      const addedMonth = s.addedMonth ? parseInt(s.addedMonth) : 1;
      const addedYear = s.addedYear ? parseInt(s.addedYear) : currentYear;
      const isBeforeAdded = (currentYear < addedYear) || (currentYear === addedYear && currentMonth < addedMonth);
      if (isBeforeAdded) return;
      if (isDeletedForReport(s, currentMonth, currentYear)) return;
      ts++;
      const isPaid = s.paidMonths && s.paidMonths[currentMonthKey];
      const pp = s.partialPayments && s.partialPayments[currentMonthKey];
      const hasPartial = pp && pp.length > 0;
      if (isPaid) {
        pc++;
      } else if (hasPartial) {
        rc++;
      } else {
        uc++;
      }
    });
    return { totalSubscribers: ts, paidCount: pc, requiredCount: rc, unpaidCount: uc };
  }, [subscribers, currentMonthKey, currentMonth, currentYear]);

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor={isOnline ? "#FF9800" : "#FF5722"} barStyle="light-content" />
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="white" />
          <Text style={styles.offlineBannerText}>لا يوجد اتصال بالإنترنت - البيانات قد لا تُحفظ</Text>
        </View>
      )}
      <View style={[styles.header, { backgroundColor: '#FF9800' }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.logoutButton} onPress={() => Alert.alert('تسجيل الخروج', 'هل أنت متأكد أنك تريد تسجيل الخروج؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'نعم', style: 'destructive', onPress: onLogout }])}>
            <Ionicons name="log-out-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{generatorName || 'واجهة العامل'}</Text>
        {workerName ? <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>{workerName}</Text> : null}
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.dateContainer}>
          <Text style={styles.dateText}>{currentMonth} / {currentYear}</Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.totalCard]}>
            <Text style={[styles.statNumber, styles.totalNumber]} numberOfLines={1} adjustsFontSizeToFit>{totalSubscribers}</Text>
            <Text style={[styles.statLabel, styles.totalLabel]} numberOfLines={1} adjustsFontSizeToFit>عدد المشتركين</Text>
          </View>
          <View style={[styles.statCard, styles.amperCard]}>
            <Text style={[styles.statNumber, styles.amperNumber]} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(totalAmper)}</Text>
            <View style={styles.amperLabelContainer}>
              <Text style={[styles.statLabel, styles.amperLabel]} numberOfLines={1} adjustsFontSizeToFit>أميبر</Text>
              <Ionicons name="flash" size={IS_SMALL ? 12 : 14} color="#FF9800" />
            </View>
          </View>
          <View style={[styles.statCard, styles.paidCard]}>
            <Text style={[styles.statNumber, styles.paidNumber]} numberOfLines={1} adjustsFontSizeToFit>{paidCount}</Text>
            <Text style={[styles.statLabel, styles.paidLabel]} numberOfLines={1} adjustsFontSizeToFit>مدفوع</Text>
          </View>
          <View style={[styles.statCard, styles.unpaidCard]}>
            <Text style={[styles.statNumber, styles.unpaidNumber]} numberOfLines={1} adjustsFontSizeToFit>{unpaidCount}</Text>
            <Text style={[styles.statLabel, styles.unpaidLabel]} numberOfLines={1} adjustsFontSizeToFit>غير مدفوع</Text>
          </View>
          <View style={[styles.statCard, styles.requiredCard]}>
            <Text style={[styles.statNumber, styles.requiredNumber]} numberOfLines={1} adjustsFontSizeToFit>{requiredCount}</Text>
            <Text style={[styles.statLabel, styles.requiredLabel]} numberOfLines={1} adjustsFontSizeToFit>المطلوبين</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-around', marginHorizontal: 16, marginTop: 4, marginBottom: 8 }}>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
              <Ionicons name="flash" size={14} color="#FF9800" />
              <Text style={{ fontSize: 12, color: darkMode ? '#aaa' : '#666', textAlign: 'center' }}>سعر الأمبير</Text>
            </View>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', textAlign: 'center' }}>{formatNumber(normalPrice)} د.ع</Text>
          </View>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Text style={{ fontSize: 12, color: darkMode ? '#aaa' : '#666', textAlign: 'center' }}>سعر الذهبي</Text>
            </View>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', textAlign: 'center' }}>{formatNumber(goldenPriceVal)} د.ع</Text>
          </View>
        </View>

        <View style={styles.bottomButtons}>
          {generators && generators.length > 1 && workerAssignedGenerators && workerAssignedGenerators.length > 1 && (
            <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#FF9800', marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]} onPress={onShowWorkerSwitchGenerator}>
              <Ionicons name="swap-horizontal-outline" size={20} color="white" />
              <Text style={styles.showSubscribersText}>تبديل المولد ({generators.length})</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.showSubscribersButton} onPress={onShowSubscribers}>
            <Ionicons name="people" size={20} color="white" />
            <Text style={styles.showSubscribersText}>عرض المشتركين</Text>
          </TouchableOpacity>
          {workerPermissions.includes('addExpense') && (
            <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#FF5722', marginTop: 10 }]} onPress={onShowExpense}>
              <Ionicons name="receipt-outline" size={20} color="white" />
              <Text style={styles.showSubscribersText}>إضافة صرفية</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#9C27B0', marginTop: 10 }]} onPress={onShowReports}>
            <Ionicons name="bar-chart-outline" size={20} color="white" />
            <Text style={styles.showSubscribersText}>التقارير</Text>
          </TouchableOpacity>
        </View>

        {workerUpdates.length > 0 && isOnline && (
          <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#2196F3', marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]} onPress={onSync}>
            <Ionicons name="cloud-upload-outline" size={20} color="white" />
            <Text style={styles.showSubscribersText}>رفع التحديثات ({workerUpdates.length})</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const _notifRef = { addNotification: function() {}, removeNotification: function() {} };

const NotificationContext = createContext();

const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const addNotification = useCallback((notif) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [{ ...notif, id }, ...prev].slice(0, 3));
    setTimeout(() => { setNotifications(prev => prev.filter(n => n.id !== id)); }, 4000);
  }, []);
  const removeNotification = useCallback((id) => { setNotifications(prev => prev.filter(n => n.id !== id)); }, []);
  React.useEffect(function() { _notifRef.addNotification = addNotification; _notifRef.removeNotification = removeNotification; }, [addNotification, removeNotification]);
  return (
    <NotificationContext.Provider value={{ notifications, addNotification, removeNotification }}>
      {children}
    </NotificationContext.Provider>
  );
};

const useNotification = () => {
  return { showNotification: function(type, title, message) { _notifRef.addNotification({ type: type, title: title, message: message }); }, removeNotification: function(id) { _notifRef.removeNotification(id); } };
};

const AppNotification = () => {
  const ctx = useContext(NotificationContext);
  const notifications = ctx ? ctx.notifications : [];
  const removeNotification = ctx ? ctx.removeNotification : function() {};
  if (!notifications || notifications.length === 0) return null;
  const getIcon = (type) => {
    switch (type) {
      case 'success': return { icon: '\u2713', bg: '#1B5E20' };
      case 'error': return { icon: '\u2717', bg: '#B71C1C' };
      case 'warning': return { icon: '\u26A0', bg: '#E65100' };
      default: return { icon: '\u2139', bg: '#1565C0' };
    }
  };
  const getBorderColor = (type) => {
    switch (type) {
      case 'success': return '#1B5E20';
      case 'error': return '#B71C1C';
      case 'warning': return '#E65100';
      default: return '#1565C0';
    }
  };
  return (
    <View style={{ position: 'absolute', top: 50, left: 16, right: 16, zIndex: 9999 }} pointerEvents="box-none">
      {notifications.map((notif, index) => (
        <NotificationItem key={notif.id} notif={notif} index={index} onDismiss={() => removeNotification(notif.id)} getIcon={getIcon} getBorderColor={getBorderColor} />
      ))}
    </View>
  );
};

const NotificationItem = ({ notif, index, onDismiss, getIcon, getBorderColor }) => {
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 10,
    onPanResponderMove: (_, gs) => { if (gs.dy < 0) panY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy < -50) { Animated.timing(slideAnim, { toValue: -100, duration: 200, useNativeDriver: true }).start(() => onDismiss()); }
      else { Animated.spring(panY, { toValue: 0, useNativeDriver: true }).start(); }
    },
  })).current;
  useEffect(() => { Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }).start(); }, []);
  const { icon, bg } = getIcon(notif.type);
  const borderColor = getBorderColor(notif.type);
  return (
    <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateY: Animated.add(slideAnim, panY) }], backgroundColor: '#1C2333EE', borderRadius: 16, minHeight: 70, padding: 16, borderLeftWidth: 4, borderLeftColor: borderColor, elevation: 20, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginBottom: index < 2 ? 8 : 0 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: 'white', fontSize: 15, fontWeight: 'bold', textAlign: 'right' }}>{notif.title}</Text>
        <Text style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'right', marginTop: 2 }}>{notif.message}</Text>
      </View>
    </Animated.View>
  );
};

const MultiMonthPaymentScreen = ({ visible, onClose, subscribers, amperPrices, goldenPrices, onConfirm }) => {
  const { showNotification } = useNotification();
  const [step, setStep] = useState('search');
  const [searchText, setSearchText] = useState('');
  const [selectedSubscriber, setSelectedSubscriber] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonths, setSelectedMonths] = useState([]);
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const years = [];
  for (let y = currentYear + 1; y >= currentYear - 3; y--) years.push(y);
  const resetState = () => { setStep('search'); setSearchText(''); setSelectedSubscriber(null); setSelectedYear(null); setSelectedMonths([]); };
  const filtered = subscribers.filter(sub => !sub.deletedFromMonth && (sub.name.includes(searchText) || (sub.subscriberNumber && sub.subscriberNumber.includes(searchText)) || (sub.meterNumber && sub.meterNumber.includes(searchText))));
  const toggleMonth = (mk) => { setSelectedMonths(prev => prev.includes(mk) ? prev.filter(x => x !== mk) : [...prev, mk]); };
  const getMonthDue = (m, y) => {
    const mk = `${m}_${y}`;
    const price = getPriceForSubscriber(amperPrices, goldenPrices, mk, selectedSubscriber.subscriptionType);
    const amper = getAmperForMonth(selectedSubscriber, m, y);
    const isPaid = selectedSubscriber.paidMonths && selectedSubscriber.paidMonths[mk];
    if (isPaid) return 0;
    const pp = selectedSubscriber.partialPayments && selectedSubscriber.partialPayments[mk];
    const totalPaid = pp ? pp.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) : 0;
    return amper * price - totalPaid;
  };
  const totalDue = selectedMonths.reduce((sum, mk) => { const [m, y] = mk.split('_'); return sum + getMonthDue(m, y); }, 0);
  if (!visible) return null;
  return (
    <View style={styles.subscribersOverlay}>
      <View style={styles.subscribersContainer}>
        <View style={styles.subscribersHeader}>
          <TouchableOpacity onPress={() => { if (step === 'months') { setStep('year'); } else if (step === 'year') { setStep('search'); setSelectedSubscriber(null); setSelectedYear(null); setSelectedMonths([]); } else { resetState(); onClose(); } }} style={styles.backButton}>
            <Ionicons name="arrow-forward" size={26} color="white" />
          </TouchableOpacity>
          <Text style={styles.subscribersTitle}>{step === 'search' ? 'اختر مشترك' : step === 'year' ? `اختر السنة - ${selectedSubscriber.name}` : `${selectedYear} - ${selectedSubscriber.name}`}</Text>
          <View style={{ width: 40 }} />
        </View>
        {step === 'search' && (
          <>
            <View style={{ paddingHorizontal: IS_SMALL ? 12 : 16, paddingVertical: IS_SMALL ? 10 : 12, backgroundColor: '#f5f5f5' }}>
              <TextInput style={{ backgroundColor: 'white', borderRadius: IS_SMALL ? 8 : 10, paddingHorizontal: IS_SMALL ? 12 : 14, paddingVertical: IS_SMALL ? 10 : 12, fontSize: IS_SMALL ? 13 : 15, textAlign: 'right', borderWidth: 1, borderColor: '#E0E0E0' }} placeholder="ابحث بالاسم أو رقم الهاتف أو رقم الجوزة..." placeholderTextColor="#999" value={searchText} onChangeText={setSearchText} />
            </View>
            <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
              {filtered.length === 0 ? (
                <View style={{ padding: IS_SMALL ? 30 : 40, alignItems: 'center' }}>
                  <Ionicons name="search-outline" size={60} color="#ccc" />
                  <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#999', marginTop: IS_SMALL ? 10 : 14 }}>{searchText ? 'لا يوجد نتائج' : 'اكتب اسم المشترك للبحث'}</Text>
                </View>
              ) : (
                filtered.map(sub => (
                  <TouchableOpacity key={sub.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: IS_SMALL ? 14 : 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: 'white' }} onPress={() => { setSelectedSubscriber(sub); setStep('year'); setSelectedMonths([]); setSelectedYear(null); }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 10 : 12 }}>
                      <View style={{ width: IS_SMALL ? 40 : 44, height: IS_SMALL ? 40 : 44, borderRadius: IS_SMALL ? 20 : 22, backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="person" size={IS_SMALL ? 20 : 22} color="#1565C0" />
                      </View>
                      <View>
                        <Text style={{ fontSize: IS_SMALL ? 14 : 16, fontWeight: '600', color: '#333', textAlign: 'right' }}>{sub.name}</Text>
                        <Text style={{ fontSize: IS_SMALL ? 11 : 12, color: '#999', textAlign: 'right', marginTop: 2 }}>{sub.subscriberNumber || ''} {sub.meterNumber ? `| الجوزة: ${sub.meterNumber}` : ''}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-back" size={20} color="#ccc" />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </>
        )}
        {step === 'year' && (
          <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={{ padding: IS_SMALL ? 12 : 16 }}>
              <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: '#666', marginBottom: IS_SMALL ? 12 : 16, textAlign: 'right' }}>اختر السنة:</Text>
              {years.map(y => {
                const isAvailable = y <= currentYear;
                return (
                  <TouchableOpacity key={y} style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: IS_SMALL ? 14 : 16, borderRadius: IS_SMALL ? 10 : 12, marginBottom: IS_SMALL ? 8 : 10, borderWidth: 1.5, borderColor: '#E0E0E0', backgroundColor: isAvailable ? 'white' : '#f5f5f5', opacity: isAvailable ? 1 : 0.5 }} onPress={() => { if (isAvailable) { setSelectedYear(y); setStep('months'); } }} disabled={!isAvailable}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 8 : 10 }}>
                      <Ionicons name="calendar" size={IS_SMALL ? 22 : 26} color="#1565C0" />
                      <Text style={{ fontSize: IS_SMALL ? 16 : 18, color: '#333', fontWeight: 'bold' }}>{y}</Text>
                    </View>
                    <Ionicons name="chevron-back" size={IS_SMALL ? 18 : 22} color="#999" />
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}
        {step === 'months' && (
          <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
            <View style={{ padding: IS_SMALL ? 12 : 16 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                const mk = `${m}_${selectedYear}`;
                const due = getMonthDue(m, selectedYear);
                const isSelected = selectedMonths.includes(mk);
                const isPaid = !!selectedSubscriber.paidMonths && !!selectedSubscriber.paidMonths[mk];
                const isFuture = selectedYear === currentYear && m > currentMonth;
                const priceSet = getPriceForSubscriber(amperPrices, goldenPrices, mk, selectedSubscriber.subscriptionType) > 0;
                const isDisabled = !!isPaid || (isFuture && !priceSet);
                return (
                  <TouchableOpacity key={mk} style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: IS_SMALL ? 12 : 14, borderRadius: IS_SMALL ? 8 : 10, marginBottom: IS_SMALL ? 6 : 8, borderWidth: 1.5, borderColor: isSelected ? '#2196F3' : isPaid ? '#4CAF50' : '#E0E0E0', backgroundColor: isSelected ? '#E3F2FD' : isPaid ? '#E8F5E9' : isDisabled ? '#f5f5f5' : 'white', opacity: isDisabled && !isPaid ? 0.5 : 1 }} onPress={() => { if (!isDisabled) toggleMonth(mk); }} disabled={isDisabled}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: IS_SMALL ? 6 : 8 }}>
                      <Ionicons name={isPaid ? 'checkmark-circle' : isSelected ? 'checkbox' : 'square-outline'} size={IS_SMALL ? 20 : 24} color={isPaid ? '#4CAF50' : isSelected ? '#2196F3' : '#999'} />
                      <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#333', fontWeight: isSelected ? 'bold' : 'normal' }}>{m}/{selectedYear} - {monthNames[m - 1]}</Text>
                    </View>
                    <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: isPaid ? '#4CAF50' : isDisabled && !isPaid ? '#999' : '#333', fontWeight: 'bold' }}>{isPaid ? 'مدفوع' : isFuture && !priceSet ? 'لم يُحدد السعر' : `د.ع ${formatNumber(due)}`}</Text>
                  </TouchableOpacity>
                );
              })}
              {selectedMonths.length > 0 && (
                <View style={{ backgroundColor: '#E3F2FD', borderRadius: IS_SMALL ? 10 : 12, padding: IS_SMALL ? 14 : 16, marginTop: IS_SMALL ? 8 : 12, borderWidth: 1, borderColor: '#2196F3' }}>
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: IS_SMALL ? 6 : 8 }}>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: '#666' }}>عدد الأشهر:</Text>
                    <Text style={{ fontSize: IS_SMALL ? 13 : 15, fontWeight: 'bold', color: '#333' }}>{selectedMonths.length}</Text>
                  </View>
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#333', fontWeight: 'bold' }}>المبلغ الإجمالي:</Text>
                    <Text style={{ fontSize: IS_SMALL ? 14 : 16, color: '#1565C0', fontWeight: 'bold' }}>د.ع {formatNumber(totalDue)}</Text>
                  </View>
                </View>
              )}
              {selectedMonths.length > 0 && (
                <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: IS_SMALL ? 10 : 12, paddingVertical: IS_SMALL ? 12 : 14, width: '100%', alignItems: 'center', marginTop: IS_SMALL ? 14 : 18, flexDirection: 'row', justifyContent: 'center', gap: IS_SMALL ? 6 : 8 }} onPress={() => { onConfirm(selectedMonths, totalDue, selectedSubscriber); resetState(); onClose(); }}>
                  <Ionicons name="checkmark-circle" size={IS_SMALL ? 18 : 22} color="white" />
                  <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>تأكيد الدفع</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
};

const TrialBanner = ({ subscriptionData, onPress }) => {
  if (!subscriptionData) return null;
  if (subscriptionData.status === 'active') return null;
  const isTrial = subscriptionData.status === 'trial';
  const bgColor = isTrial ? 'rgba(255,193,7,0.12)' : 'rgba(244,67,54,0.12)';
  const borderColor = isTrial ? '#FFC107' : '#F44336';
  const icon = isTrial ? 'flask' : 'alert-circle';
  const iconColor = isTrial ? '#FFC107' : '#F44336';
  const title = isTrial ? 'فترة التجربة المجانية' : 'اشتراك منتهي';
  const days = subscriptionData.daysLeft || 0;
  const subtitle = isTrial ? 'متبقي ' + days + ' يوم من أصل 30 يوم مجاني' : 'اشتراكك منتهي. للتفعيل: 20,000 د.ع لمدة 6 أشهر';
  return (
    <TouchableOpacity onPress={onPress} style={{ backgroundColor: bgColor, borderWidth: 1, borderColor: borderColor, borderRadius: 12, padding: 12, marginHorizontal: 16, marginTop: 8, flexDirection: 'row', alignItems: 'center' }} activeOpacity={0.7}>
      <Ionicons name={icon} size={24} color={iconColor} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: iconColor, fontSize: 13, fontWeight: 'bold', fontFamily: 'System' }}>{title}</Text>
        <Text style={{ color: '#9CA3AF', fontSize: 11, fontFamily: 'System' }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={iconColor} />
    </TouchableOpacity>
  );
};

const WorkerExpiredScreen = ({ onLogout }) => {
  return (
    <View style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', alignItems: 'center', padding: 30 }}>
      <StatusBar backgroundColor="#0A0E1A" barStyle="light-content" />
      <View style={{ width: 100, height: 100, borderRadius: 24, backgroundColor: 'rgba(244,67,54,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
        <Ionicons name="lock-closed" size={50} color="#F44336" />
      </View>
      <Text style={{ color: '#F44336', fontSize: 24, fontWeight: 'bold', marginBottom: 10, fontFamily: 'System' }}>اشتراك منتهي</Text>
      <Text style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20, fontFamily: 'System' }}>اشتراك صاحب المولد قد انتهى.{'\n'}لا يمكنك استخدام التطبيق حتى يتم تجديد الاشتراك.</Text>
      <TouchableOpacity onPress={function() { Linking.openURL('whatsapp://send?phone=9647802524458&text=' + encodeURIComponent('مرحباً، اشتراك صاحب المولد قد انتهى. أريد تجديد الاشتراك.')).catch(function() { Alert.alert('خطأ', 'لم يتم فتح الواتساب'); }); }} style={{ backgroundColor: '#4CAF50', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, width: '100%', alignItems: 'center', marginBottom: 16 }} activeOpacity={0.8}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', fontFamily: 'System' }}>تواصل مع الدعم</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onLogout} style={{ paddingVertical: 12, paddingHorizontal: 30 }} activeOpacity={0.8}>
        <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'System' }}>تسجيل الخروج</Text>
      </TouchableOpacity>
    </View>
  );
};

const ExpiredScreen = ({ onActivate, ownerName, onLogout, currentUser, onCodeActivated }) => {
  const [activationCode, setActivationCode] = React.useState('');
  const [activating, setActivating] = React.useState(false);

  var handleRedeemCode = async function() {
    if (!activationCode.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال كود التفعيل');
      return;
    }
    if (!currentUser) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم');
      return;
    }
    setActivating(true);
    try {
      var result = await apiRequest('POST', '/api', { _action: 'redeemActivationCode', phone: currentUser, code: activationCode.trim().toUpperCase() });
      if (result && result.ok) {
        if (onCodeActivated) onCodeActivated(result.subscription_ends_at);
      } else {
        Alert.alert('خطأ', result && result.error ? result.error : 'الكود غير صحيح');
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء الاتصال بالخادم');
    }
    setActivating(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', alignItems: 'center', padding: 30 }}>
      <StatusBar backgroundColor="#0A0E1A" barStyle="light-content" />
      <View style={{ width: 100, height: 100, borderRadius: 24, backgroundColor: 'rgba(244,67,54,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
        <Ionicons name="lock-closed" size={50} color="#F44336" />
      </View>
      <Text style={{ color: '#F44336', fontSize: 24, fontWeight: 'bold', marginBottom: 10, fontFamily: 'System' }}>اشتراك منتهي</Text>
      <Text style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 8, fontFamily: 'System' }}>مرحباً {ownerName || 'عميلنا'}،</Text>
      <Text style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20, fontFamily: 'System' }}>اشتراكك في تطبيق مولدي قد انتهى. أدخل كود التفعيل للحصول على 6 أشهر.</Text>
      <TextInput style={{ width: '100%', backgroundColor: '#1C2333', borderRadius: 12, padding: 14, color: '#fff', fontSize: 18, textAlign: 'center', letterSpacing: 2, marginBottom: 12, fontFamily: 'System', borderWidth: 1, borderColor: activationCode ? '#1565C0' : '#333' }} placeholder="أدخل كود التفعيل" placeholderTextColor="#666" value={activationCode} onChangeText={setActivationCode} autoCapitalize="characters" />
      <TouchableOpacity onPress={handleRedeemCode} disabled={activating || !activationCode.trim()} style={{ backgroundColor: activationCode.trim() ? '#1565C0' : '#333', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, width: '100%', marginBottom: 16, opacity: activating ? 0.6 : 1 }} activeOpacity={0.8}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center', fontFamily: 'System' }}>{activating ? 'جاري التفعيل...' : 'تفعيل الكود'}</Text>
      </TouchableOpacity>
      <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: '#333' }} />
        <Text style={{ color: '#666', fontSize: 12, marginHorizontal: 10, fontFamily: 'System' }}>أو</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: '#333' }} />
      </View>
      <TouchableOpacity onPress={onActivate} style={{ backgroundColor: '#25D366', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, width: '100%', marginBottom: 12 }} activeOpacity={0.8}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center', fontFamily: 'System' }}>جدّد الاشتراك من خلال مراسلة الدعم</Text>
      </TouchableOpacity>
      <Text style={{ color: '#6B7280', fontSize: 13, fontFamily: 'System', marginBottom: 12 }}>+964 780 252 4458</Text>
      <TouchableOpacity onPress={onLogout} activeOpacity={0.7}>
        <Text style={{ color: '#6B7280', fontSize: 13, fontFamily: 'System' }}>تسجيل الخروج</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function App() {
  const insets = useSafeAreaInsets();
  const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
  const [screen, setScreen] = useState('welcome');
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [generatorName, setGeneratorName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [subscribersVisible, setSubscribersVisible] = useState(false);
  const [reportsVisible, setReportsVisible] = useState(false);
  const [workerExpenseVisible, setWorkerExpenseVisible] = useState(false);
  const [workerExpenseType, setWorkerExpenseType] = useState('');
  const [workerExpenseAmount, setWorkerExpenseAmount] = useState('');
  const [subscribers, setSubscribers] = useState([]);
  const [amperPrices, setAmperPrices] = useState({});
  const [goldenPrices, setGoldenPrices] = useState({});
  const [monthlyExpenses, setMonthlyExpenses] = useState({});
  const [workerExpenses, setWorkerExpenses] = useState({});
  const [userRole, setUserRole] = useState(null);
  const [workerOwnerPhone, setWorkerOwnerPhone] = useState(null);
  const [workerPermissions, setWorkerPermissions] = useState([]);
  const [workerCode, setWorkerCode] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [workerUpdates, setWorkerUpdates] = useState([]);
  const [pendingWorkerUpdates, setPendingWorkerUpdates] = useState([]);
  const [workerActivityLog, setWorkerActivityLog] = useState([]);
  const [workerTrackingVisible, setWorkerTrackingVisible] = useState(false);
  const [workers, setWorkers] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [currentGeneratorId, setCurrentGeneratorId] = useState(null);

  const [workerAssignedGeneratorId, setWorkerAssignedGeneratorId] = useState(null);
  const [workerAssignedGenerators, setWorkerAssignedGenerators] = useState([]);
  const [workerSwitchGeneratorVisible, setWorkerSwitchGeneratorVisible] = useState(false);
  const [newWorkerCredentials, setNewWorkerCredentials] = useState(null);
  const [updatesModalVisible, setUpdatesModalVisible] = useState(false);
  const [monthlyDataVisible, setMonthlyDataVisible] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [lastSubscribersMonth, setLastSubscribersMonth] = useState(String(new Date().getMonth() + 1));
  const [lastSubscribersYear, setLastSubscribersYear] = useState(String(new Date().getFullYear()));
  const [deletedGenerators, setDeletedGenerators] = useState([]);
  const [globalLoading, setGlobalLoading] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [addWorkerModalVisible, setAddWorkerModalVisible] = useState(false);
  const [addWorkerName, setAddWorkerName] = useState('');
  const [addWorkerPerms, setAddWorkerPerms] = useState([]);
  const [addWorkerAssignedGens, setAddWorkerAssignedGens] = useState([]);
  const [editWorkerModalVisible, setEditWorkerModalVisible] = useState(false);
  const [editWorkerSel, setEditWorkerSel] = useState(null);
  const [editWorkerPerms, setEditWorkerPerms] = useState([]);
  const [editWorkerAssignedGens, setEditWorkerAssignedGens] = useState([]);
  const [changePassVisible, setChangePassVisible] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [appPartialPaymentVisible, setAppPartialPaymentVisible] = useState(false);
  const [appPartialPaymentSubscriber, setAppPartialPaymentSubscriber] = useState(null);
  const [appPartialPaymentMonthKey, setAppPartialPaymentMonthKey] = useState('');
  const [multiMonthPaymentVisible, setMultiMonthPaymentVisible] = useState(false);
  const [multiMonthPaymentSubscriber, setMultiMonthPaymentSubscriber] = useState(null);
  const [appLocked, setAppLocked] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState(null);

  const isAuthenticating = useRef(false);
  const appState = useRef(AppState.currentState);
  const lastActivity = React.useRef(Date.now());

  const SESSION_TIMEOUT = 30 * 60 * 1000;

  useEffect(() => {
    let done = false;
    const safeFinish = () => { if (!done) { done = true; setIsLoading(false); } };
    const timer = setTimeout(safeFinish, 5000);
    const init = async () => {
      try {
        const onboardingResult = await Promise.race([
          loadLocalCache('app_onboarding_done'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        if (!onboardingResult) {
          setShowOnboarding(true);
        }
        const savedUserStr = await SecureStore.getItemAsync('current_user');
        const savedUser = savedUserStr ? JSON.parse(savedUserStr) : null;
        if (savedUser && savedUser.phone) {
          setCurrentUser(savedUser.phone);
          setUserRole(savedUser.role || 'owner');
          if (savedUser.role === 'worker') {
            setWorkerCode(savedUser.workerCode || '');
            setWorkerName(savedUser.workerName || '');
            setWorkerPermissions(savedUser.permissions || []);
            setWorkerOwnerPhone(savedUser.phone);
            setWorkerAssignedGenerators(savedUser.assignedGenerators || []);
            if (savedUser.assignedGeneratorId) setWorkerAssignedGeneratorId(savedUser.assignedGeneratorId);
            setScreen('workerMain');
          } else {
            setScreen('main');
          }
          setActiveTab('home');
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const isEnrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false;
          if (isEnrolled) {
            setAppLocked(true);
          }
          if (savedUser.role === 'owner') {
            const regTime = await SecureStore.getItemAsync('registration_' + savedUser.phone);
            const now = new Date();
            if (regTime) {
              const elapsed = now.getTime() - new Date(regTime).getTime();
              if (elapsed > TRIAL_DURATION_MS) {
                const subData = await SecureStore.getItemAsync('subscription_' + savedUser.phone);
                let hasActive = false;
                if (subData) {
                  const parsed = JSON.parse(subData);
                  if (parsed.subscription_ends_at && now < new Date(parsed.subscription_ends_at)) hasActive = true;
                }
                if (!hasActive) {
                  setSubscriptionData({ status: 'expired', daysLeft: 0 });
                }
              }
            }
            checkSubscription(savedUser.phone);
          }
          if (savedUser.role === 'worker') {
            checkSubscription(savedUser.phone);
          }
        }
      } catch (e) {
        setShowOnboarding(true);
      }
      clearTimeout(timer);
      safeFinish();
    };
    init();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadAllUserData();
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const checkSubExpiry = async () => {
      try {
        const net = await NetInfo.fetch();
        if (!net.isConnected) return;
        const result = await apiRequest('POST', '/api', { _action: 'checkSubscription', phone: currentUser });
        if (result) {
          SecureStore.setItemAsync('subscription_' + currentUser, JSON.stringify(result)).catch(function() {});
          setSubscriptionData(prev => {
            if (prev && prev.status === 'expired' && result.status === 'expired') return prev;
            return result;
          });
        }
      } catch (e) {}
    };
    checkSubExpiry();
    const interval = setInterval(checkSubExpiry, 15000);
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') checkSubExpiry();
    });
    return () => { clearInterval(interval); appStateSub.remove(); };
  }, [currentUser]);

  const authenticateUser = React.useCallback(async () => {
    if (isAuthenticating.current) return;

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false;

    if (!hasHardware || !isEnrolled) {
      setAppLocked(false);
      return;
    }

    isAuthenticating.current = true;

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'ادخل رمز جهازك لفتح مولدي',
        cancelLabel: 'إلغاء',
        disableDeviceFallback: false,
        fallbackLabel: 'استخدم رمز الجهاز',
      });

      if (result.success) {
        setAppLocked(false);
      }
    } catch (error) {
    } finally {
      isAuthenticating.current = false;
    }
  }, []);

  useEffect(() => {
    if (appLocked) {
      authenticateUser();
    }
  }, [appLocked, authenticateUser]);

  const checkSubscription = React.useCallback(async (phone) => {
    try {
      const net = await NetInfo.fetch();
      if (!net.isConnected) {
        const localData = await SecureStore.getItemAsync('subscription_' + phone);
        if (localData) {
          setSubscriptionData(JSON.parse(localData));
          return true;
        }
        setSubscriptionData({ status: 'active', daysLeft: 999 });
        return true;
      }
      const result = await apiRequest('POST', '/api', { _action: 'checkSubscription', phone });
      if (result) {
        SecureStore.setItemAsync('subscription_' + phone, JSON.stringify(result)).catch(function() {});
        setSubscriptionData(result);
        return result.status !== 'expired';
      }
      return true;
    } catch (e) {
      setSubscriptionData({ status: 'active', daysLeft: 999 });
      return true;
    }
  }, []);

  const isFirstRender = React.useRef(true);
  const generatorsRef = React.useRef(generators);
  generatorsRef.current = generators;
  const currentGeneratorIdRef = React.useRef(currentGeneratorId);
  currentGeneratorIdRef.current = currentGeneratorId;
  const workerExpensesRef = React.useRef(workerExpenses);
  workerExpensesRef.current = workerExpenses;
  const syncTimerRef = React.useRef(null);

  const defaultExpenses = { gas: '', oil: '', repairs: '', salaries: '' };
  const currentMonthKeyForMain = `${new Date().getMonth() + 1}_${new Date().getFullYear()}`;
  const expenses = monthlyExpenses[currentMonthKeyForMain] || defaultExpenses;
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!currentGeneratorId || generatorsRef.current.length === 0) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const genId = currentGeneratorIdRef.current;
      const updated = generatorsRef.current.map(g => {
        if (g.id === genId) {
          return { ...g, subscribers, amperPrices, goldenPrices, monthlyExpenses, workerExpenses };
        }
        return g;
      });
      setGenerators(updated);
      if (userRole !== 'worker') {
        saveUserData(currentUser, 'generators', updated);
      }
    }, 3000);
  }, [subscribers, amperPrices, goldenPrices, monthlyExpenses]);

  useEffect(() => {
    if (userRole === 'worker' && screen === 'main') {
      setScreen('workerMain');
    }
    if (userRole !== 'worker' && screen === 'workerMain') {
      setScreen('main');
    }
  }, [userRole, screen]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        (appState.current === 'background' || appState.current === 'inactive')
        && nextState === 'active'
      ) {
        setAppLocked(true);
        setTimeout(() => authenticateUser(), 150);
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [authenticateUser]);

  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivity.current > SESSION_TIMEOUT) {
        handleLogout();
      }
    }, 60000);
    const appSub = AppState.addEventListener('change', function(state) {
      if (state === 'active') lastActivity.current = Date.now();
    });
    return () => { clearInterval(interval); appSub.remove(); };
  }, [currentUser]);

  const dismissedBatchIdsRef = React.useRef(new Set());

  useEffect(() => {
    if (!currentUser || userRole === 'worker') return;
    const pollInterval = setInterval(async () => {
      try {
        const result = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(currentUser) + '&key=pending_worker_updates');
        var cloudBatches = [];
        if (Array.isArray(result) && result.length > 0) {
          var val = result[0].data_value;
          if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
          cloudBatches = normalizeBatches(val);
        }
        var newCount = 0;
        setPendingWorkerUpdates(prev => {
          const prevIds = new Set(prev.map(function(b) { return b.id; }));
          var dismissed = dismissedBatchIdsRef.current;
          var newBatches = cloudBatches.filter(function(b) { return !prevIds.has(b.id) && !dismissed.has(b.id); });
          if (newBatches.length > 0) {
            newCount = newBatches.length;
            return [...prev, ...newBatches];
          }
          return prev;
        });
        if (newCount > 0) {
          _notifRef.addNotification({ type: 'warning', title: 'تحديثات العامل', message: 'تم رفع ' + newCount + ' دفعة تحديثات من العامل. افتح تتبع العامل لمراجعتها.' });
        }
      } catch(e) {}
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [currentUser, userRole]);

  const refreshPendingUpdates = React.useCallback(async function() {
    if (!currentUser || userRole === 'worker') return;
    try {
      var result = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(currentUser) + '&key=pending_worker_updates');
      var cloudBatches = [];
      if (Array.isArray(result) && result.length > 0) {
        var val = result[0].data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
        cloudBatches = normalizeBatches(val);
      }
      var dismissed = dismissedBatchIdsRef.current;
      setPendingWorkerUpdates(cloudBatches.filter(function(b) { return !dismissed.has(b.id); }));
    } catch(e) {}
  }, [currentUser, userRole]);

  const workerSyncRef = React.useRef({ generators: generators, currentGeneratorId: currentGeneratorId });
  const seenRejectedIdsRef = React.useRef(new Set());
  const firstPollDoneRef = React.useRef(false);
  useEffect(() => {
    workerSyncRef.current = { generators, currentGeneratorId };
  }, [generators, currentGeneratorId]);

  useEffect(() => {
    if (userRole !== 'worker' || !workerOwnerPhone) return;
    const pollInterval = setInterval(async () => {
      try {
        var all = {};
        const keys = ['generators', 'workers', 'worker_activity_log'];
        for (var ki = 0; ki < keys.length; ki++) {
          try {
            var r = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(workerOwnerPhone) + '&key=' + keys[ki]);
            if (Array.isArray(r) && r.length > 0) {
              var v = r[0].data_value;
              if (typeof v === 'string') { try { v = JSON.parse(v); } catch(pe) {} }
              all[keys[ki]] = v;
            }
          } catch(e) {}
        }
        if (all.worker_activity_log && Array.isArray(all.worker_activity_log)) {
          var rejectedBatches = all.worker_activity_log.filter(function(b) { return b.status === 'rejected'; });
          if (!firstPollDoneRef.current) {
            rejectedBatches.forEach(function(b) { if (b.id) seenRejectedIdsRef.current.add(b.id); });
            firstPollDoneRef.current = true;
          } else {
            var newRejections = rejectedBatches.filter(function(b) { return b.id && !seenRejectedIdsRef.current.has(b.id); });
            if (newRejections.length > 0) {
              newRejections.forEach(function(b) { seenRejectedIdsRef.current.add(b.id); });
              Alert.alert('تم رفض تحديث', 'تم رفض تحديثاتك من قبل صاحب المولد (' + newRejections.length + ' تحديث)');
            }
          }
        }
        const ownerWorkers = all.workers || [];
        if (ownerWorkers.length > 0) {
          const stillExists = ownerWorkers.find(function(w) { return w.code === workerCode; });
          if (!stillExists) {
            Alert.alert('تم الحذف', 'تم حذف حسابك من قبل صاحب المولد. سيتم تسجيل الخروج.');
            handleLogout();
            return;
          }
          if (stillExists) {
            const newPerms = stillExists.permissions || [];
            setWorkerPermissions(newPerms);
            const newAssignedGens = stillExists.assignedGenerators || [];
            setWorkerAssignedGenerators(newAssignedGens);
          }
        }
        if (all.generators && all.generators.length > 0) {
          const workerCurrentId = currentGeneratorId;
          const workerActive = all.generators.find(function(g) { return g.id === workerCurrentId; }) || all.generators[0];
          if (workerActive) {
            const oldRef = workerSyncRef.current;
            const oldActive = oldRef.generators.find(function(g) { return g.id === workerCurrentId; }) || oldRef.generators[0];
            const newSubs = workerActive.subscribers || [];
            const oldSubs = oldActive ? (oldActive.subscribers || []) : [];
            const newPrices = workerActive.amperPrices || {};
            const oldPrices = oldActive ? (oldActive.amperPrices || {}) : {};
            const newGoldenPrices = workerActive.goldenPrices || {};
            const oldGoldenPrices = oldActive ? (oldActive.goldenPrices || {}) : {};
            const newExpenses = workerActive.monthlyExpenses || {};
            const oldExpenses = oldActive ? (oldActive.monthlyExpenses || {}) : {};
            const subsChanged = JSON.stringify(newSubs) !== JSON.stringify(oldSubs);
            const pricesChanged = JSON.stringify(newPrices) !== JSON.stringify(oldPrices);
            const goldenPricesChanged = JSON.stringify(newGoldenPrices) !== JSON.stringify(oldGoldenPrices);
            const expensesChanged = JSON.stringify(newExpenses) !== JSON.stringify(oldExpenses);
            if (subsChanged || pricesChanged || goldenPricesChanged || expensesChanged) {
              setGenerators(all.generators);
              setSubscribers(newSubs);
              if (pricesChanged) setAmperPrices(newPrices);
              if (goldenPricesChanged) setGoldenPrices(newGoldenPrices);
              if (expensesChanged) setMonthlyExpenses(newExpenses);
            } else {
              setGenerators(all.generators);
            }
          }
        }
      } catch (e) {
        // silent
      }
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [userRole, workerOwnerPhone, currentGeneratorId]);

  const resetActivity = () => {
    lastActivity.current = Date.now();
  };

  const checkLoggedIn = async () => {
    setIsLoading(false);
  };

  const loadAllUserData = async () => {
    if (!currentUser) return;
    const all = await loadAllUserKeys(currentUser);
    if (all.ownerName !== undefined && all.ownerName.trim()) setOwnerName(all.ownerName);
    else {
      var usersResult = await loadFromFile('registered_users');
      var usersList = usersResult || [];
      var user = usersList.find(function(u) { return u.phone === currentUser; });
      if (user && user.ownerName && user.ownerName.trim()) setOwnerName(user.ownerName.trim());
    }
    if (all.pending_worker_updates !== undefined) { const batches = normalizeBatches(all.pending_worker_updates); setPendingWorkerUpdates(batches); if (batches.length > 0) { setTimeout(function() { _notifRef.addNotification({ type: 'warning', title: 'تحديثات العامل', message: 'لديك ' + batches.length + ' دفعة تحديثات من العامل بانتظار المراجعة.' }); }, 1500); } }
    if (all.worker_activity_log !== undefined) setWorkerActivityLog(all.worker_activity_log);
    if (all.workers !== undefined) setWorkers(all.workers);
    if (all.darkMode !== undefined) setDarkMode(all.darkMode);
    if (all.lastSubscribersMonth) setLastSubscribersMonth(all.lastSubscribersMonth);
    if (all.lastSubscribersYear) setLastSubscribersYear(all.lastSubscribersYear);

    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const savedDeleted = all.deletedGenerators || [];
    const validDeleted = savedDeleted.filter(function(dg) {
      return dg.deletedAt > oneMonthAgo;
    });
    if (validDeleted.length !== savedDeleted.length) {
      await saveUserData(currentUser, 'deletedGenerators', validDeleted);
    }
    setDeletedGenerators(validDeleted);

    let loadedGenerators = all.generators || [];
    let loadedCurrentId = all.currentGeneratorId || null;

    if (loadedGenerators.length === 0 && all.subscribers !== undefined) {
      const migrated = {
        id: Date.now().toString(),
        name: all.generatorName || 'المولد الرئيسي',
        subscribers: all.subscribers || [],
        amperPrices: all.amperPrices || {},
        monthlyExpenses: all.monthlyExpenses || {},
      };
      loadedGenerators = [migrated];
      loadedCurrentId = migrated.id;
      await saveUserData(currentUser, 'generators', loadedGenerators);
      await saveUserData(currentUser, 'currentGeneratorId', loadedCurrentId);
    }

    if (loadedGenerators.length > 0) {
      setGenerators(loadedGenerators);
      setCurrentGeneratorId(loadedCurrentId);
      const active = loadedGenerators.find(g => g.id === loadedCurrentId) || loadedGenerators[0];
      if (active) {
        setGeneratorName(active.name);
        setSubscribers(active.subscribers || []);
        setAmperPrices(active.amperPrices || {});
        setGoldenPrices(active.goldenPrices || {});
        setMonthlyExpenses(active.monthlyExpenses || {});
        setWorkerExpenses(active.workerExpenses || {});
        if (!loadedCurrentId || loadedCurrentId !== active.id) {
          setCurrentGeneratorId(active.id);
          await saveUserData(currentUser, 'currentGeneratorId', active.id);
        }
      }
    } else {
      if (all.generatorName !== undefined) setGeneratorName(all.generatorName);
      if (all.amperPrices !== undefined) setAmperPrices(all.amperPrices);
      if (all.goldenPrices !== undefined) setGoldenPrices(all.goldenPrices);
      if (all.subscribers !== undefined) setSubscribers(all.subscribers);
      if (all.monthlyExpenses !== undefined) setMonthlyExpenses(all.monthlyExpenses);
    }
    syncPendingChanges(currentUser);
  };

  const saveCurrentGeneratorData = async (updatedGenerators) => {
    setGenerators(updatedGenerators);
    if (currentUser) await saveUserData(currentUser, 'generators', updatedGenerators);
  };

  const syncSubscribersToGenerator = async (newSubs) => {
    const updated = generators.map(g => {
      if (g.id === currentGeneratorId) {
        return { ...g, subscribers: newSubs };
      }
      return g;
    });
    setGenerators(updated);
    if (currentUser) await saveUserData(currentUser, 'generators', updated);
  };

  const handleCreateGenerator = async (name) => {
    setGlobalLoading('جاري إنشاء المولد...');
    try {
      const newGen = {
        id: Date.now().toString(),
        name: name.trim(),
        subscribers: [],
        amperPrices: {},
        monthlyExpenses: {},
      };
      const updated = [...generators, newGen];
      setGenerators(updated);
      setCurrentGeneratorId(newGen.id);
      setGeneratorName(newGen.name);
      setSubscribers([]);
      setAmperPrices({});
      setGoldenPrices({});
      setMonthlyExpenses({});
      if (currentUser) {
        await saveUserData(currentUser, 'generators', updated);
        await saveUserData(currentUser, 'currentGeneratorId', newGen.id);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء إنشاء المولد');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleSwitchGenerator = async (genId) => {
    setGlobalLoading('جاري التبديل...');
    try {
      if (genId === currentGeneratorId) return;

      const updatedGenerators = generators.map(g => {
        if (g.id === currentGeneratorId) {
          return { ...g, subscribers, amperPrices, goldenPrices, monthlyExpenses, workerExpenses };
        }
        return g;
      });

      const target = updatedGenerators.find(g => g.id === genId);
      if (!target) return;

      setGenerators(updatedGenerators);
      setCurrentGeneratorId(genId);
      setGeneratorName(target.name);
      setSubscribers(target.subscribers || []);
      setAmperPrices(target.amperPrices || {});
      setGoldenPrices(target.goldenPrices || {});
      setMonthlyExpenses(target.monthlyExpenses || {});
      setWorkerExpenses(target.workerExpenses || {});
      if (currentUser) {
        await saveUserData(currentUser, 'generators', updatedGenerators);
        await saveUserData(currentUser, 'currentGeneratorId', genId);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء التبديل بين المولدات');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleDeleteGenerator = async (genId, password) => {
    setGlobalLoading('جاري حذف المولد...');
    try {
      const usersResult = await loadFromFile('registered_users');
      const usersList = usersResult || [];
      const user = usersList.find(function(u) { return u.phone === currentUser; });
      if (!user) return false;
      const verifyResult = await verifyOwnerPassword(user.password, password, currentUser);
      if (!verifyResult.match) return false;
      if (generators.length <= 1) {
        Alert.alert('تنبيه', 'لا يمكن حذف المولد الوحيد');
        return false;
      }
      const genToDelete = generators.find(function(g) { return g.id === genId; });
      if (!genToDelete) return false;
      const genData = { ...genToDelete, subscribers: genToDelete.subscribers || [], amperPrices: genToDelete.amperPrices || {}, goldenPrices: genToDelete.goldenPrices || {}, monthlyExpenses: genToDelete.monthlyExpenses || {} };
      const deletedEntry = {
        id: genToDelete.id,
        name: genToDelete.name,
        data: genData,
        deletedAt: Date.now(),
      };
      const updatedGenerators = generators.filter(function(g) { return g.id !== genId; });
      const updatedDeleted = [...deletedGenerators, deletedEntry];
      setGenerators(updatedGenerators);
      setDeletedGenerators(updatedDeleted);
      const active = updatedGenerators[0];
      setCurrentGeneratorId(active.id);
      setGeneratorName(active.name);
      setSubscribers(active.subscribers || []);
      setAmperPrices(active.amperPrices || {});
      setGoldenPrices(active.goldenPrices || {});
      setMonthlyExpenses(active.monthlyExpenses || {});
      await saveUserData(currentUser, 'currentGeneratorId', active.id);
      await saveUserData(currentUser, 'deletedGenerators', updatedDeleted);
      return true;
    } finally {
      setGlobalLoading('');
    }
  };

  const handleRestoreGenerator = async (genId) => {
    setGlobalLoading('جاري استرداد المولد...');
    try {
      const entry = deletedGenerators.find(function(dg) { return dg.id === genId; });
      if (!entry) return;
      const restored = entry.data || { id: entry.id, name: entry.name, subscribers: [], amperPrices: {}, goldenPrices: {}, monthlyExpenses: {} };
      const updatedGenerators = [...generators, restored];
      const updatedDeleted = deletedGenerators.filter(function(dg) { return dg.id !== genId; });
      setGenerators(updatedGenerators);
      setDeletedGenerators(updatedDeleted);
      await saveUserData(currentUser, 'generators', updatedGenerators);
      await saveUserData(currentUser, 'deletedGenerators', updatedDeleted);
      Alert.alert('تم', 'تم استرداد المولد "' + entry.name + '" بنجاح');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء استرداد المولد');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleLogin = async (userPhone) => {
    if (userRole === 'worker') return;
    setCurrentUser(userPhone);
    setActiveTab('home');
    setScreen('main');
    checkSubscription(userPhone);
  };

  const handleOnboardingComplete = async () => {
    await saveToFile('onboarding_done', true);
    setShowOnboarding(false);
    if (currentUser) {
      setScreen('');
    } else {
      setScreen('welcome');
    }
  };

  const handleChangePassword = async (oldPassword, newPassword) => {
    setGlobalLoading('جاري تغيير كلمة المرور...');
    try {
      const usersResult = await loadFromFile('registered_users');
      if (!usersResult) return false;
      const usersList = usersResult || [];
      const user = usersList.find(function(u) { return u.phone === currentUser; });
      if (!user) return false;
      const verifyResult = await verifyOwnerPassword(user.password, oldPassword, currentUser);
      if (!verifyResult.match) return false;
      const newHash = await pbkdf2Hash(newPassword, currentUser);
      user.password = newHash;
      await saveToFile('registered_users', usersList);
      return true;
    } catch (e) {
      return false;
    } finally {
      setGlobalLoading('');
    }
  };

  const handleLogout = async () => {
    setGlobalLoading('جاري تسجيل الخروج...');
    try {
      await SecureStore.deleteItemAsync('current_user').catch(function() {});
      setCurrentUser(null);
      setUserRole(null);
      setWorkerOwnerPhone(null);
      setWorkerPermissions([]);
      setWorkerCode('');
      setWorkerName('');
      setWorkerUpdates([]);
      setPendingWorkerUpdates([]);
      setWorkers([]);
      setGeneratorName('');
      setOwnerName('');
      setAmperPrices({});
      setGoldenPrices({});
      setSubscribers([]);
      setMonthlyExpenses({});
      setGenerators([]);
      setCurrentGeneratorId(null);
      setNewWorkerCredentials(null);
      setDeletedGenerators([]);
      setScreen('login');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تسجيل الخروج');
    } finally {
      setGlobalLoading('');
    }
  };

  const trackWorkerUpdate = (type, subscriberId, subscriberName, amper, monthKey, details) => {
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
    const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
    const update = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      type,
      subscriberId,
      subscriberName,
      amper,
      monthKey,
      timestamp,
      date: now.toISOString(),
      workerCode: workerCode || '',
      ownerName: workerName || workerCode || '',
      details: details || {},
    };
    setWorkerUpdates(prev => [...prev, update]);
  };

  const handleDeleteWorkerExpense = (monthKey, expenseIndex) => {
    setGlobalLoading('جاري حذف الصرفية...');
    try {
      const newWorkerExpenses = Object.assign({}, workerExpenses);
      const monthArr = newWorkerExpenses[monthKey] ? newWorkerExpenses[monthKey].slice() : [];
      monthArr.splice(expenseIndex, 1);
      if (monthArr.length === 0) {
        delete newWorkerExpenses[monthKey];
      } else {
        newWorkerExpenses[monthKey] = monthArr;
      }
      setWorkerExpenses(newWorkerExpenses);
      workerExpensesRef.current = newWorkerExpenses;
      if (currentUser) saveUserData(currentUser, 'workerExpenses', newWorkerExpenses);
      if (currentGeneratorId && generators.length > 0) {
        const updated = generators.map(g => g.id === currentGeneratorId ? { ...g, workerExpenses: newWorkerExpenses } : g);
        setGenerators(updated);
        saveUserData(currentUser, 'generators', updated);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حذف الصرفية');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleWorkerAddExpense = (expenseType, amount, monthKey) => {
    const timestamp = new Date();
    const hours = timestamp.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = timestamp.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = timestamp.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
    const newExpense = { type: expenseType, amount: amount, timestamp: `${dateStr} - ${timeStr} ${ampm}`, date: timestamp.toISOString(), workerName: workerName || '' };
    const current = workerExpenses[monthKey] || [];
    const updated = { ...workerExpenses };
    updated[monthKey] = [...current, newExpense];
    setWorkerExpenses(updated);
    trackWorkerUpdate('addExpense', '', expenseType, 0, monthKey, { expenseType, amount });
  };

  const handleWorkerSync = async () => {
    if (workerUpdates.length === 0) {
      Alert.alert('تنبيه', 'لا توجد تحديثات للرفع');
      return;
    }
    if (!isOnline) {
      Alert.alert('تنبيه', 'لا يوجد اتصال بالإنترنت. حاول لاحقاً');
      return;
    }
    setGlobalLoading('جاري رفع التحديثات...');
    try {
      const existing = await loadUserData(workerOwnerPhone, 'pending_worker_updates') || [];
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
      const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
      const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
      const batchNumber = existing.length + 1;
      const batch = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        number: batchNumber,
        timestamp: `${dateStr} - ${timeStr} ${ampm}`,
        workerName: workerName || workerCode || '',
        workerCode: workerCode || '',
        updates: workerUpdates,
        generatorId: workerAssignedGeneratorId || null,
      };
      const merged = [...existing, batch];
      const result = await saveUserData(workerOwnerPhone, 'pending_worker_updates', merged);
      const existingLog = await loadUserData(workerOwnerPhone, 'worker_activity_log') || [];
      const logBatch = { ...batch, status: 'pending' };
      await saveUserData(workerOwnerPhone, 'worker_activity_log', [...existingLog, logBatch]);
      await syncPendingChanges(workerOwnerPhone);
      if (result !== undefined) {
        setWorkerUpdates([]);
        Alert.alert('تم', 'تم رفع التحديثات بنجاح');
      } else {
        Alert.alert('خطأ', 'فشل رفع التحديثات');
      }
    } catch (e) {
      Alert.alert('خطأ', 'فشل رفع التحديثات');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleSaveWorkerExpense = () => {
    if (!workerExpenseType.trim()) {
      Alert.alert('تنبيه', 'أدخل نوع الصرفية');
      return;
    }
    const parsed = parseFloat(workerExpenseAmount.replace(/,/g, ''));
    if (!parsed || parsed <= 0) {
      Alert.alert('تنبيه', 'أدخل مبلغ صحيح');
      return;
    }
    const currentMonthKey2 = `${new Date().getMonth() + 1}_${new Date().getFullYear()}`;
    handleWorkerAddExpense(workerExpenseType.trim(), parsed, currentMonthKey2);
    setWorkerExpenseType('');
    setWorkerExpenseAmount('');
    setWorkerExpenseVisible(false);
  };

  const handleApplyBatch = async (batchId) => {
    if (pendingWorkerUpdates.length === 0) return;
    const batch = pendingWorkerUpdates.find(b => b.id === batchId);
    if (!batch) return;

    setGlobalLoading('جاري تطبيق التحديثات...');
    const targetGenId = batch.generatorId || currentGeneratorId;
    const isDifferentGen = targetGenId && targetGenId !== currentGeneratorId;
    const targetGen = isDifferentGen ? generators.find(g => g.id === targetGenId) : null;
    let newSubs = isDifferentGen ? [...(targetGen?.subscribers || [])] : [...subscribers];
    let newWorkerExpenses = isDifferentGen ? { ...(targetGen?.workerExpenses || {}) } : { ...workerExpenses };
    for (const update of batch.updates) {
      switch (update.type) {
        case 'add': {
          const exists = newSubs.find(s => s.id === update.subscriberId);
          if (!exists) {
            newSubs.push({
              id: update.subscriberId,
              name: update.subscriberName,
              amper: update.amper,
              phone: update.details.phone || '',
              subscriberNumber: update.details.subscriberNumber || '',
              meterNumber: update.details.meterNumber || '',
              visaNumber: update.details.visaNumber || '',
              subscriptionType: update.details.subscriptionType || 'normal',
              addedMonth: update.details.addedMonth || new Date().getMonth() + 1,
              addedYear: update.details.addedYear || new Date().getFullYear(),
              paidMonths: {},
              paymentHistory: [],
              partialPayments: {},
              amperHistory: update.details.amperHistory || [],
              date: update.date,
            });
          }
          break;
        }
        case 'paid':
        case 'cancelled': {
          const subIndex = newSubs.findIndex(s => s.id === update.subscriberId);
          if (subIndex >= 0) {
            const sub = { ...newSubs[subIndex] };
            sub.paidMonths = { ...sub.paidMonths };
            sub.paidMonths[update.monthKey] = update.type === 'paid';
            sub.paymentHistory = [...(sub.paymentHistory || []), {
              monthKey: update.monthKey,
              action: update.type,
              timestamp: update.timestamp,
              date: update.date,
              ownerName: update.ownerName,
            }];
            sub.partialPayments = { ...sub.partialPayments };
            if (update.type === 'cancelled') {
              delete sub.partialPayments[update.monthKey];
            }
            if (sub.rejectedPayments) {
              sub.rejectedPayments = { ...sub.rejectedPayments };
              delete sub.rejectedPayments[update.monthKey];
            }
            newSubs[subIndex] = sub;
          }
          break;
        }
        case 'partialPayment': {
          const subIndex = newSubs.findIndex(s => s.id === update.subscriberId);
          if (subIndex >= 0) {
            const sub = { ...newSubs[subIndex] };
            sub.partialPayments = { ...sub.partialPayments };
            const monthPayments = [...(sub.partialPayments[update.monthKey] || [])];
            monthPayments.push({
              amount: update.details.amount,
              timestamp: update.timestamp,
              date: update.date,
              ownerName: update.ownerName,
            });
            sub.partialPayments[update.monthKey] = monthPayments;
            const pmParts = update.monthKey.split('_');
            const totalDue = getAmperForMonth(sub, parseInt(pmParts[0]), parseInt(pmParts[1])) * getPriceForSubscriber(amperPrices, goldenPrices, update.monthKey, sub.subscriptionType);
            const totalPaid = monthPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
            sub.paidMonths = { ...sub.paidMonths };
            sub.paymentHistory = [...(sub.paymentHistory || [])];
            if (totalPaid >= totalDue && !sub.paidMonths[update.monthKey]) {
              sub.paidMonths[update.monthKey] = true;
              sub.paymentHistory.push({
                monthKey: update.monthKey,
                action: 'paid',
                timestamp: update.timestamp,
                date: update.date,
                ownerName: update.ownerName,
                note: 'اكتمال الدفع عبر دفعات جزئية',
              });
            }
            newSubs[subIndex] = sub;
          }
          break;
        }
        case 'delete': {
          const subIndex = newSubs.findIndex(s => s.id === update.subscriberId);
          if (subIndex >= 0) {
            newSubs[subIndex] = {
              ...newSubs[subIndex],
              deletedFromMonth: update.monthKey,
              deletedAt: update.timestamp,
              deletedByOwner: update.ownerName,
            };
          }
          break;
        }
        case 'edit': {
          const subIndex = newSubs.findIndex(s => s.id === update.subscriberId);
          if (subIndex >= 0) {
            const sub = { ...newSubs[subIndex] };
            if (update.details.name) sub.name = update.details.name;
            if (update.details.phone) sub.phone = update.details.phone;
            if (update.details.subscriberNumber !== undefined) sub.subscriberNumber = update.details.subscriberNumber;
            if (update.details.meterNumber !== undefined) sub.meterNumber = update.details.meterNumber;
            if (update.details.visaNumber !== undefined) sub.visaNumber = update.details.visaNumber;
            if (update.details.subscriptionType !== undefined) sub.subscriptionType = update.details.subscriptionType;
            if (update.details.amper !== undefined) {
              sub.amperHistory = [...(sub.amperHistory || [])];
              const existingIdx = sub.amperHistory.findIndex(h => h.monthKey === update.monthKey);
              if (existingIdx >= 0) {
                sub.amperHistory[existingIdx] = { monthKey: update.monthKey, amper: update.details.amper };
              } else {
                sub.amperHistory.push({ monthKey: update.monthKey, amper: update.details.amper });
              }
            }
            newSubs[subIndex] = sub;
          }
          break;
        }
        case 'restore': {
          const subIndex = newSubs.findIndex(s => s.id === update.subscriberId);
          if (subIndex >= 0) {
            const sub = { ...newSubs[subIndex] };
            delete sub.deletedFromMonth;
            delete sub.deletedAt;
            delete sub.deletedByOwner;
            newSubs[subIndex] = sub;
          }
          break;
        }
        case 'addExpense': {
          const monthKey = update.monthKey || '';
          const expenseEntry = {
            type: update.details.expenseType || update.subscriberName || '',
            amount: update.details.amount || 0,
            timestamp: update.timestamp,
            date: update.date,
            workerName: update.ownerName || '',
          };
          if (!newWorkerExpenses[monthKey]) newWorkerExpenses[monthKey] = [];
          newWorkerExpenses[monthKey] = [...newWorkerExpenses[monthKey], expenseEntry];
          break;
        }
      }
    }

    setSubscribers(newSubs);
    if (!isDifferentGen) { setWorkerExpenses(newWorkerExpenses); workerExpensesRef.current = newWorkerExpenses; }
    var remainingBatches = pendingWorkerUpdates.filter(b => b.id !== batchId);
    const existingLog = await loadUserData(currentUser, 'worker_activity_log') || [];
    const updatedLog = existingLog.map(b => b.id === batchId ? { ...b, status: 'applied' } : b);
    await saveUserData(currentUser, 'worker_activity_log', updatedLog);
    if (generators.length > 0) {
      const updated = generators.map(g => {
        if (g.id === targetGenId) {
          return { ...g, subscribers: newSubs, workerExpenses: newWorkerExpenses };
        }
        return g;
      });
      setGenerators(updated);
      if (isDifferentGen) {
        const currentGen = updated.find(g => g.id === currentGeneratorId);
        if (currentGen) { setSubscribers(currentGen.subscribers || []); setWorkerExpenses(currentGen.workerExpenses || {}); }
      }
      await saveUserData(currentUser, 'generators', updated);
      try {
        var cloudResult2 = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(currentUser) + '&key=pending_worker_updates');
        var cloudBatches2 = [];
        if (Array.isArray(cloudResult2) && cloudResult2.length > 0) {
          var cv2 = cloudResult2[0].data_value;
          if (typeof cv2 === 'string') { try { cv2 = JSON.parse(cv2); } catch(pe2) {} }
          cloudBatches2 = normalizeBatches(cv2);
        }
        remainingBatches = cloudBatches2.filter(function(b) { return b.id !== batchId; });
      } catch(fetchErr2) {}
      await saveUserData(currentUser, 'pending_worker_updates', remainingBatches);
      await syncPendingChanges(currentUser);
    } else {
      await saveUserData(currentUser, 'subscribers', newSubs);
      await saveUserData(currentUser, 'pending_worker_updates', remainingBatches);
      await syncPendingChanges(currentUser);
    }
    setPendingWorkerUpdates(remainingBatches);
    dismissedBatchIdsRef.current.add(batchId);
    setUpdatesModalVisible(false);
    setGlobalLoading('');

    refreshPendingUpdates();
  };

  const handleDeleteBatch = async (batchId) => {
    try {
      const batch = pendingWorkerUpdates.find(b => b.id === batchId);
      const remaining = pendingWorkerUpdates.filter(b => b.id !== batchId);
      setPendingWorkerUpdates(remaining);
      dismissedBatchIdsRef.current.add(batchId);
      try {
        var cloudResult = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(currentUser) + '&key=pending_worker_updates');
        var cloudBatches = [];
        if (Array.isArray(cloudResult) && cloudResult.length > 0) {
          var cv = cloudResult[0].data_value;
          if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(pe) {} }
          cloudBatches = normalizeBatches(cv);
        }
        var cloudRemaining = cloudBatches.filter(function(b) { return b.id !== batchId; });
        await saveUserData(currentUser, 'pending_worker_updates', cloudRemaining);
      } catch(fetchErr) {
        await saveUserData(currentUser, 'pending_worker_updates', remaining);
      }
      if (batch) {
        const now = new Date();
        const hours = now.getHours();
        const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
        const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
        const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
        const rejectedTimestamp = dateStr + ' - ' + timeStr + ' ' + ampm;
        const rejectedDate = now.toISOString();
        const targetGenId = batch.generatorId || currentGeneratorId;
        const isDifferentGen = targetGenId && targetGenId !== currentGeneratorId;
        const targetGen = isDifferentGen ? generators.find(function(g) { return g.id === targetGenId; }) : null;
        var newSubs = isDifferentGen ? (targetGen ? targetGen.subscribers || [] : []) : [...subscribers];
        var newWorkerExpenses = isDifferentGen ? (targetGen ? Object.assign({}, targetGen.workerExpenses || {}) : {}) : Object.assign({}, workerExpenses);
        for (var i = 0; i < (batch.updates || []).length; i++) {
          var update = batch.updates[i];
          switch (update.type) {
            case 'paid': {
              var subIdx = newSubs.findIndex(function(s) { return s.id === update.subscriberId; });
              if (subIdx >= 0) {
                var sub = Object.assign({}, newSubs[subIdx]);
                sub.paidMonths = Object.assign({}, sub.paidMonths || {});
                sub.paidMonths[update.monthKey] = false;
                sub.partialPayments = Object.assign({}, sub.partialPayments || {});
                delete sub.partialPayments[update.monthKey];
                sub.paymentHistory = (sub.paymentHistory || []).concat([{
                  monthKey: update.monthKey,
                  action: 'rejected_by_owner',
                  timestamp: rejectedTimestamp,
                  date: rejectedDate,
                  ownerName: ownerName,
                }]);
                sub.rejectedPayments = sub.rejectedPayments || {};
                sub.rejectedPayments[update.monthKey] = { ownerName: ownerName, timestamp: rejectedTimestamp, date: rejectedDate };
                newSubs[subIdx] = sub;
              }
              break;
            }
            case 'cancelled': {
              var subIdx = newSubs.findIndex(function(s) { return s.id === update.subscriberId; });
              if (subIdx >= 0) {
                var sub = Object.assign({}, newSubs[subIdx]);
                sub.paidMonths = Object.assign({}, sub.paidMonths || {});
                sub.paidMonths[update.monthKey] = false;
                sub.partialPayments = Object.assign({}, sub.partialPayments || {});
                delete sub.partialPayments[update.monthKey];
                newSubs[subIdx] = sub;
              }
              break;
            }
            case 'partialPayment': {
              var subIdx = newSubs.findIndex(function(s) { return s.id === update.subscriberId; });
              if (subIdx >= 0) {
                var sub = Object.assign({}, newSubs[subIdx]);
                sub.partialPayments = Object.assign({}, sub.partialPayments || {});
                delete sub.partialPayments[update.monthKey];
                sub.paidMonths = Object.assign({}, sub.paidMonths || {});
                sub.paidMonths[update.monthKey] = false;
                sub.paymentHistory = (sub.paymentHistory || []).concat([{
                  monthKey: update.monthKey,
                  action: 'rejected_by_owner',
                  timestamp: rejectedTimestamp,
                  date: rejectedDate,
                  ownerName: ownerName,
                }]);
                sub.rejectedPayments = sub.rejectedPayments || {};
                sub.rejectedPayments[update.monthKey] = { ownerName: ownerName, timestamp: rejectedTimestamp, date: rejectedDate };
                newSubs[subIdx] = sub;
              }
              break;
            }
            case 'delete': {
              var subIdx = newSubs.findIndex(function(s) { return s.id === update.subscriberId; });
              if (subIdx >= 0) {
                var sub = Object.assign({}, newSubs[subIdx]);
                delete sub.deletedFromMonth;
                delete sub.deletedAt;
                delete sub.deletedByOwner;
                newSubs[subIdx] = sub;
              }
              break;
            }
            case 'restore': {
              var subIdx = newSubs.findIndex(function(s) { return s.id === update.subscriberId; });
              if (subIdx >= 0) {
                var sub = Object.assign({}, newSubs[subIdx]);
                sub.deletedFromMonth = update.monthKey;
                sub.deletedAt = update.timestamp;
                sub.deletedByOwner = currentUser;
                newSubs[subIdx] = sub;
              }
              break;
            }
            case 'addExpense': {
              var mk = update.monthKey || '';
              if (newWorkerExpenses[mk]) {
                newWorkerExpenses[mk] = newWorkerExpenses[mk].filter(function(e) {
                  return !(e.type === (update.details ? update.details.expenseType : '') && e.amount === (update.details ? update.details.amount : 0));
                });
              }
              break;
            }
            case 'edit': {
              var subIdx = newSubs.findIndex(function(s) { return s.id === update.subscriberId; });
              if (subIdx >= 0 && update.details) {
                var sub = Object.assign({}, newSubs[subIdx]);
                if (update.details.oldName !== undefined) sub.name = update.details.oldName;
                if (update.details.oldPhone !== undefined) sub.phone = update.details.oldPhone;
                if (update.details.oldAmper !== undefined) sub.amper = update.details.oldAmper;
                if (update.details.oldSubscriberNumber !== undefined) sub.subscriberNumber = update.details.oldSubscriberNumber;
                if (update.details.oldMeterNumber !== undefined) sub.meterNumber = update.details.oldMeterNumber;
                if (update.details.oldVisaNumber !== undefined) sub.visaNumber = update.details.oldVisaNumber;
                if (update.details.oldSubscriptionType !== undefined) sub.subscriptionType = update.details.oldSubscriptionType;
                if (update.details.oldAmperHistory !== undefined) sub.amperHistory = update.details.oldAmperHistory;
                newSubs[subIdx] = sub;
              }
              break;
            }
          }
        }
        if (!isDifferentGen) {
          setSubscribers(newSubs);
          setWorkerExpenses(newWorkerExpenses);
          workerExpensesRef.current = newWorkerExpenses;
        }
        if (generators.length > 0) {
          var updatedGens = generators.map(function(g) {
            if (g.id === targetGenId) {
              return Object.assign({}, g, { subscribers: newSubs, workerExpenses: newWorkerExpenses });
            }
            return g;
          });
          setGenerators(updatedGens);
          await saveUserData(currentUser, 'generators', updatedGens);
        }
        await saveUserData(currentUser, 'subscribers', newSubs);
        await saveUserData(currentUser, 'workerExpenses', newWorkerExpenses);
        var log = await loadUserData(currentUser, 'worker_activity_log') || [];
        log.push(Object.assign({}, batch, { status: 'rejected', rejectedBy: currentUser, rejectedAt: rejectedTimestamp, rejectedDate: rejectedDate }));
        await saveUserData(currentUser, 'worker_activity_log', log);
        setWorkerActivityLog(log);
      }
      Alert.alert('تم', 'تم رفض التحديث وإلغاء الدفع');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء رفض التحديث');
    }
    refreshPendingUpdates();
  };

  const normalizeBatches = (data) => {
    if (!data) return [];
    let d = data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch(e) { return []; } }
    if (!Array.isArray(d) || d.length === 0) return [];
    return d.map((item, idx) => {
      if (!item) return null;
      if (item.updates && Array.isArray(item.updates) && item.id && item.number) return item;
      return {
        id: 'legacy_' + idx + '_' + Date.now(),
        number: idx + 1,
        timestamp: item.timestamp || '',
        workerName: item.ownerName || '',
        updates: [item],
      };
    }).filter(Boolean);
  };

  const loadPendingUpdates = async () => {
    if (!currentUser) return;
    const updates = await loadUserData(currentUser, 'pending_worker_updates');
    setPendingWorkerUpdates(normalizeBatches(updates));
  };

  const saveGeneratorName = async (name) => {
    setGeneratorName(name);
    if (currentUser) await saveUserData(currentUser, 'generatorName', name);
    if (currentGeneratorId && generators.length > 0) {
      const updated = generators.map(g => g.id === currentGeneratorId ? { ...g, name } : g);
      setGenerators(updated);
      await saveUserData(currentUser, 'generators', updated);
    }
  };

  const saveOwnerName = async (name) => {
    if (!name || !name.trim()) return;
    setOwnerName(name.trim());
    if (currentUser) await saveUserData(currentUser, 'ownerName', name.trim());
  };

  const saveAmperPrice = async (monthKey, price) => {
    setGlobalLoading('جاري حفظ السعر...');
    try {
      const newPrices = { ...amperPrices, [monthKey]: price };
      setAmperPrices(newPrices);
      if (currentUser) await saveUserData(currentUser, 'amperPrices', newPrices);
    } catch (e) {
    } finally {
      setGlobalLoading('');
    }
  };

  const saveGoldenPrice = async (monthKey, price) => {
    setGlobalLoading('جاري حفظ السعر...');
    try {
      const newPrices = { ...goldenPrices, [monthKey]: price };
      setGoldenPrices(newPrices);
      if (currentUser) await saveUserData(currentUser, 'goldenPrices', newPrices);
    } catch (e) {
    } finally {
      setGlobalLoading('');
    }
  };

  const saveExpenses = async (exp) => {
    setGlobalLoading('جاري حفظ الصرفيات...');
    try {
      const key = `${new Date().getMonth() + 1}_${new Date().getFullYear()}`;
      const updated = { ...monthlyExpenses, [key]: exp };
      setMonthlyExpenses(updated);
      if (currentUser) await saveUserData(currentUser, 'monthlyExpenses', updated);
    } catch (e) {
    } finally {
      setGlobalLoading('');
    }
  };

  const handleSetMonthlyExpenses = async (newExpenses) => {
    setGlobalLoading('جاري حفظ الصرفية...');
    try {
      setMonthlyExpenses(newExpenses);
      if (currentUser) await saveUserData(currentUser, 'monthlyExpenses', newExpenses);
    } catch (e) {
    } finally {
      setGlobalLoading('');
    }
  };

  const handleCreateWorker = async (workerNameInput, permissions, assignedGenerators) => {
    setGlobalLoading('جاري إنشاء حساب العامل...');
    try {
      const code = generateWorkerCode(currentUser);
      const pin = generateWorkerPin();
      const hashedPin = await hashWorkerPin(pin);
      const newWorker = { code, pin: hashedPin, plainPin: pin, workerName: workerNameInput, permissions, assignedGenerators: assignedGenerators || [], assignedGeneratorId: currentGeneratorId, createdAt: new Date().toISOString() };
      const updated = [...workers, newWorker];
      await saveUserData(currentUser, 'workers', updated);
      setWorkers(updated);
      setNewWorkerCredentials({ code, pin, permissions, workerName: workerNameInput });
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء إنشاء حساب العامل');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleConfirmCreateWorker = (name, permissions, assignedGenerators) => {
    if (!name || !name.trim()) { Alert.alert('تنبيه', 'يرجى إدخال اسم العامل'); return; }
    if (!permissions || permissions.length === 0) { Alert.alert('تنبيه', 'اختر صلاحية واحدة على الأقل'); return; }
    if (!assignedGenerators || assignedGenerators.length === 0) { Alert.alert('تنبيه', 'اختر مولداً واحداً على الأقل'); return; }
    handleCreateWorker(name.trim(), permissions, assignedGenerators);
    setAddWorkerModalVisible(false);
  };

  const handleUpdateWorker = async (code, permissions, assignedGenerators) => {
    setGlobalLoading('جاري تعديل الصلاحيات...');
    try {
      const updated = workers.map(w => w.code === code ? { ...w, permissions, assignedGenerators: assignedGenerators || [] } : w);
      await saveUserData(currentUser, 'workers', updated);
      setWorkers(updated);
      Alert.alert('تم', 'تم تعديل صلاحيات العامل بنجاح');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تعديل صلاحيات العامل');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleResetWorkerPin = async (workerCode) => {
    setGlobalLoading('جاري تغيير الرمز...');
    try {
      const newPin = generateWorkerPin();
      const hashedPin = await hashWorkerPin(newPin);
      const updated = workers.map(w => w.code === workerCode ? { ...w, pin: hashedPin, plainPin: newPin } : w);
      await saveUserData(currentUser, 'workers', updated);
      setWorkers(updated);
      Alert.alert('تم تغيير الرمز', `الرمز الجديد: ${newPin}\nشاركه مع العامل فوراً!`);
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير الرمز');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleDeleteWorker = async (code) => {
    setGlobalLoading('جاري حذف العامل...');
    try {
      const deletedWorkers = await loadUserData(currentUser, 'deletedWorkers') || [];
      const worker = workers.find(w => w.code === code);
      if (worker) {
        deletedWorkers.push({ code: worker.code, deletedAt: new Date().toISOString() });
        await saveUserData(currentUser, 'deletedWorkers', deletedWorkers);
      }
      const filtered = workers.filter(w => w.code !== code);
      await saveUserData(currentUser, 'workers', filtered);
      setWorkers(filtered);
      if (userRole === 'worker' && workerCode === code) {
        handleLogout();
        Alert.alert('تم الحذف', 'تم حذف حسابك من قبل صاحب المولد');
      } else {
      Alert.alert('تم', 'تم حذف العامل بنجاح');
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حذف العامل');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleWorkerLogin = async (code, pin) => {
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      return { success: false, noInternet: true };
    }
    var usersResult = await loadFromFile('registered_users');
    var list = usersResult || [];
    if (!list || list.length === 0) {
      var cloudUsers = await apiRequest('GET', '/api?table=app_data&filename=registered_users').catch(function() { return null; });
      if (Array.isArray(cloudUsers) && cloudUsers.length > 0) {
        var val = cloudUsers[0].data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
        list = Array.isArray(val) ? val : [];
        if (list.length > 0) saveLocalCache('app_registered_users', list);
      }
    }
    var upperCode = code.toUpperCase();
    for (const user of list) {
      var workers = await loadUserData(user.phone, 'workers');
      if (!workers || workers.length === 0) {
        var cloudWorkers = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(user.phone) + '&key=workers').catch(function() { return null; });
        if (Array.isArray(cloudWorkers) && cloudWorkers.length > 0) {
          var wVal = cloudWorkers[0].data_value;
          if (typeof wVal === 'string') { try { wVal = JSON.parse(wVal); } catch(e) {} }
          workers = Array.isArray(wVal) ? wVal : [];
          if (workers.length > 0) saveLocalCache('user_' + user.phone + '_workers', workers);
        }
      }
      if (workers && workers.length > 0 && workers.some(function(w) { return w.code === upperCode; })) {
        var deletedWorkers = await loadUserData(user.phone, 'deletedWorkers') || [];
        if ((!deletedWorkers || deletedWorkers.length === 0) && user.phone) {
          var cloudDel = await apiRequest('GET', '/api?table=user_data&phone=' + encodeURIComponent(user.phone) + '&key=deletedWorkers').catch(function() { return null; });
          if (Array.isArray(cloudDel) && cloudDel.length > 0) {
            var dVal = cloudDel[0].data_value;
            if (typeof dVal === 'string') { try { dVal = JSON.parse(dVal); } catch(e) {} }
            deletedWorkers = Array.isArray(dVal) ? dVal : [];
            if (deletedWorkers.length > 0) saveLocalCache('user_' + user.phone + '_deletedWorkers', deletedWorkers);
          }
        }
        if (deletedWorkers.find(function(d) { return d.code === upperCode; })) {
          return { success: false, deleted: true };
        }
        for (const w of workers) {
          if (w.code !== upperCode) continue;
          const pinMatch = await verifyWorkerPin(w.pin, pin);
          if (!pinMatch) continue;
          var subCheck = await apiRequest('POST', '/api', { _action: 'checkSubscription', phone: user.phone }).catch(function() { return null; });
          if (subCheck && subCheck.status === 'expired') {
            return { success: false, ownerExpired: true };
          }
          return { success: true, ownerPhone: user.phone, permissions: w.permissions || [], assignedGeneratorId: w.assignedGeneratorId || null, assignedGenerators: w.assignedGenerators || [], savedName: w.workerName || '' };
        }
      }
    }
    return { success: false };
  };

  const handleAddSubscriber = async (subscriber) => {
    resetActivity();
    setGlobalLoading('جاري حفظ المشترك...');
    try {
      if (userRole === 'worker' && !workerPermissions.includes('add')) return;
      const existing = subscribers.find(s => s.id === subscriber.id);
      if (existing) {
        const duplicate = subscribers.find(s => s.name.trim() === subscriber.name.trim() && s.id !== subscriber.id);
        if (duplicate) {
          Alert.alert('تنبيه', 'يوجد مشترك آخر بنفس الاسم');
          return;
        }
        const newSubs = subscribers.map(s => s.id === subscriber.id ? subscriber : s);
        setSubscribers(newSubs);
        if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
        if (userRole === 'worker') {
          const now = new Date();
          const editMonthKey = `${now.getMonth() + 1}_${now.getFullYear()}`;
          trackWorkerUpdate('edit', subscriber.id, subscriber.name, subscriber.amper, editMonthKey, {
            name: subscriber.name,
            phone: subscriber.phone,
            amper: subscriber.amper,
            subscriberNumber: subscriber.subscriberNumber,
            meterNumber: subscriber.meterNumber,
            visaNumber: subscriber.visaNumber,
            subscriptionType: subscriber.subscriptionType || 'normal',
            oldName: existing.name,
            oldPhone: existing.phone,
            oldAmper: existing.amper,
            oldSubscriberNumber: existing.subscriberNumber,
            oldMeterNumber: existing.meterNumber,
            oldVisaNumber: existing.visaNumber,
            oldSubscriptionType: existing.subscriptionType || 'normal',
            oldAmperHistory: existing.amperHistory || [],
          });
        }
      } else {
        const duplicate = subscribers.find(s => s.name.trim() === subscriber.name.trim());
        if (duplicate) {
          Alert.alert('تنبيه', 'يوجد مشترك بنفس الاسم بالفعل');
          return;
        }
        const newSubs = [...subscribers, subscriber];
        setSubscribers(newSubs);
        if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
        if (userRole === 'worker') {
          trackWorkerUpdate('add', subscriber.id, subscriber.name, subscriber.amper, subscriber.addedMonth + '_' + subscriber.addedYear, {
            phone: subscriber.phone,
            addedMonth: subscriber.addedMonth,
            addedYear: subscriber.addedYear,
            amperHistory: subscriber.amperHistory,
            subscriberNumber: subscriber.subscriberNumber,
            meterNumber: subscriber.meterNumber,
            visaNumber: subscriber.visaNumber,
            subscriptionType: subscriber.subscriptionType || 'normal',
          });
        }
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ البيانات');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleDeleteSubscriber = async (id, monthKey) => {
    resetActivity();
    setGlobalLoading('جاري حذف المشترك...');
    try {
      if (userRole === 'worker' && !workerPermissions.includes('delete')) return;
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
      const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
      const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
      const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
      const sub = subscribers.find(s => s.id === id);

      const newSubs = subscribers.map(s => {
        if (s.id === id) {
          return {
            ...s,
            deletedFromMonth: monthKey,
            deletedAt: timestamp,
            deletedByOwner: userRole === 'worker' ? workerName : ownerName,
          };
        }
        return s;
      });
      setSubscribers(newSubs);
      if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('delete', id, sub.name, sub.amper, monthKey);
      }
      if (sub) {
        Alert.alert('تم الحذف', `تم حذف "${sub.name}" من قائمة المشتركين`);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حذف المشترك');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleTogglePaid = async (id, monthKey) => {
    resetActivity();
    try {
      const sub = subscribers.find(s => s.id === id);
      if (!sub) return;
      const isCurrentlyPaid = sub && sub.paidMonths && sub.paidMonths[monthKey];
      if (userRole === 'worker') {
        const requiredPerm = isCurrentlyPaid ? 'cancelPayment' : 'edit';
        if (!workerPermissions.includes(requiredPerm)) return;
      }
      if (isCurrentlyPaid) {
        Alert.alert('تأكيد إلغاء الدفع', `هل أنت متأكد من إلغاء دفع "${sub.name}" للشهر ${monthKey.split('_')[0]}/${monthKey.split('_')[1]}؟`, [
          { text: 'لا', style: 'cancel' },
          { text: 'نعم', onPress: () => {
            Alert.alert('تنبيه نهائي', 'سيتم حذف سجل الدفع نهائياً. هل تريد المتابعة؟', [
              { text: 'إلغاء', style: 'cancel' },
              { text: 'تأكيد الإلغاء', style: 'destructive', onPress: () => executePaymentToggle(id, monthKey, true) },
            ]);
          }},
        ]);
        return;
      }
      await executePaymentToggle(id, monthKey, false);
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير حالة الدفع');
    }
  };

  const executePaymentToggle = async (id, monthKey, isCurrentlyPaid) => {
    setGlobalLoading('جاري تحديث حالة الدفع...');
    try {
      const sub = subscribers.find(s => s.id === id);
      if (!sub) return;
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
      const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
      const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
      const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
      const monthPrice = getPriceForSubscriber(amperPrices, goldenPrices, monthKey, sub.subscriptionType);
      const amperVal = getAmperForMonth(sub, parseInt(monthKey.split('_')[0]), parseInt(monthKey.split('_')[1]));
      const amount = amperVal * monthPrice;
      const monthName = monthKey.split('_')[0];
      const yearName = monthKey.split('_')[1];
      const newSubs = subscribers.map(s => {
        if (s.id === id) {
          const paidMonths = s.paidMonths ? { ...s.paidMonths } : {};
          paidMonths[monthKey] = !isCurrentlyPaid ? amount : false;
          const paymentHistory = s.paymentHistory ? [...s.paymentHistory] : [];
          paymentHistory.push({
            monthKey,
            action: isCurrentlyPaid ? 'cancelled' : 'paid',
            timestamp,
            date: now.toISOString(),
            ownerName: userRole === 'worker' ? workerName : ownerName,
          });
          const partialPayments = s.partialPayments ? { ...s.partialPayments } : {};
          if (isCurrentlyPaid) {
            delete partialPayments[monthKey];
          }
          const rejectedPayments = s.rejectedPayments ? { ...s.rejectedPayments } : {};
          if (rejectedPayments[monthKey]) {
            delete rejectedPayments[monthKey];
          }
          return { ...s, paidMonths, paymentHistory, partialPayments, rejectedPayments: Object.keys(rejectedPayments).length > 0 ? rejectedPayments : undefined };
        }
        return s;
      });
      setSubscribers(newSubs);
      if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate(isCurrentlyPaid ? 'cancelled' : 'paid', id, sub.name, sub.amper, monthKey, { amount });
      }
      if (!isCurrentlyPaid && sub.subscriberNumber && sub.subscriberNumber.trim()) {
        const payerName = userRole === 'worker' ? workerName : ownerName;
        const subTypeLabel = sub.subscriptionType === 'golden' ? 'اشتراك ذهبي' : 'اشتراك عادي';
        const msg = `إشعار دفع - ${generatorName}\n\nالعميل: ${sub.name}\nالشهر: ${monthName}/${yearName}\nنوع الاشتراك: ${subTypeLabel}\nعدد الأمبير: ${amperVal}\nسعر الامبير لهذا الشهر: ${formatNumber(monthPrice)} د.ع\nالمبلغ الإجمالي: د.ع ${formatNumber(amount)}\nالحالة: مدفوع\n\nتم الدفع بواسطة: ${payerName}\nالتاريخ: ${timestamp}`;
        Alert.alert('إرسال فاتورة واتساب', 'هل تريد إرسال إشعار الدفع للمشترك على الواتساب؟', [
          { text: 'لا', style: 'cancel' },
          { text: 'نعم', onPress: () => {
            const phone = sub.subscriberNumber.replace(/^0/, '964');
            const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);
            Linking.openURL(url).catch(() => Alert.alert('خطأ', 'لا يمكن فتح الواتساب'));
          }},
        ]);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير حالة الدفع');
    } finally {
      setGlobalLoading('');
    }
  };

  const handlePartialPayment = async (id, amount, monthKey) => {
    resetActivity();
    setGlobalLoading('جاري تسجيل الدفع الجزئي...');
    try {
      if (userRole === 'worker' && !workerPermissions.includes('partialPayment')) return;
      const sub = subscribers.find(s => s.id === id);
      if (!sub) return;
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
      const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
      const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
      const timestamp = `${dateStr} - ${timeStr} ${ampm}`;

      const newSubs = subscribers.map(s => {
        if (s.id === id) {
          const partialPayments = s.partialPayments ? { ...s.partialPayments } : {};
          const monthPayments = partialPayments[monthKey] ? [...partialPayments[monthKey]] : [];
          monthPayments.push({
            amount: amount,
            timestamp,
            date: now.toISOString(),
            ownerName: userRole === 'worker' ? workerName : ownerName,
          });
          partialPayments[monthKey] = monthPayments;

          const pmParts = monthKey.split('_');
          const totalDue = getAmperForMonth(s, parseInt(pmParts[0]), parseInt(pmParts[1])) * getPriceForSubscriber(amperPrices, goldenPrices, monthKey, s.subscriptionType);
          const totalPaid = monthPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
          const paidMonths = s.paidMonths ? { ...s.paidMonths } : {};
          const paymentHistory = s.paymentHistory ? [...s.paymentHistory] : [];

          if (totalPaid >= totalDue && !paidMonths[monthKey]) {
            paidMonths[monthKey] = true;
            paymentHistory.push({
              monthKey,
              action: 'paid',
              timestamp,
              date: now.toISOString(),
              ownerName: userRole === 'worker' ? workerName : ownerName,
              note: 'اكتمال الدفع عبر دفعات جزئية',
            });
          }

          return { ...s, partialPayments, paidMonths, paymentHistory };
        }
        return s;
      });
      setSubscribers(newSubs);
      if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('partialPayment', id, sub.name, sub.amper, monthKey, { amount });
      }
      if (sub && sub.subscriberNumber && sub.subscriberNumber.trim()) {
        const pmParts2 = monthKey.split('_');
        const amperVal2 = getAmperForMonth(sub, parseInt(pmParts2[0]), parseInt(pmParts2[1]));
        const pricePerAmper2 = getPriceForSubscriber(amperPrices, goldenPrices, monthKey, sub.subscriptionType);
        const totalDue2 = amperVal2 * pricePerAmper2;
        const newSub2 = newSubs.find(s => s.id === id);
        const monthPayments2 = newSub2 && newSub2.partialPayments && newSub2.partialPayments[monthKey] ? newSub2.partialPayments[monthKey] : [];
        const totalPaid2 = monthPayments2.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        const payerName2 = userRole === 'worker' ? workerName : ownerName;
        const subTypeLabel2 = sub.subscriptionType === 'golden' ? 'اشتراك ذهبي' : 'اشتراك عادي';
        const msg2 = `إشعار دفع جزئي - ${generatorName}\n\nالعميل: ${sub.name}\nالشهر: ${pmParts2[0]}/${pmParts2[1]}\nنوع الاشتراك: ${subTypeLabel2}\nعدد الأمبير: ${amperVal2}\nسعر الامبير لهذا الشهر: ${formatNumber(pricePerAmper2)} د.ع\nالمبلغ المدفوع: د.ع ${formatNumber(amount)}\nالإجمالي: د.ع ${formatNumber(totalDue2)}\nالواصل: د.ع ${formatNumber(totalPaid2)}\nالمتبقي: د.ع ${formatNumber(totalDue2 - totalPaid2)}\n\nتم بواسطة: ${payerName2}\nالتاريخ: ${timestamp}`;
        Alert.alert('إرسال فاتورة واتساب', 'هل تريد إرسال إشعار الدفع الجزئي للمشترك على الواتساب؟', [
          { text: 'لا', style: 'cancel' },
          { text: 'نعم', onPress: () => {
            const phone2 = sub.subscriberNumber.replace(/^0/, '964');
            const url2 = 'https://wa.me/' + phone2 + '?text=' + encodeURIComponent(msg2);
            Linking.openURL(url2).catch(() => Alert.alert('خطأ', 'لا يمكن فتح الواتساب'));
          }},
        ]);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء الدفع الجزئي');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleMultiMonthPayment = async (selectedMonths, totalDue, sub) => {
    if (!sub || selectedMonths.length === 0) return;
    const missingMonths = [];
    for (const mk of selectedMonths) {
      const price = getPriceForSubscriber(amperPrices, goldenPrices, mk, sub.subscriptionType);
      if (!price || price === 0) {
        const [m, y] = mk.split('_');
        missingMonths.push(`${m}/${y}`);
      }
    }
    if (missingMonths.length > 0) {
      Alert.alert('خطأ', `لم يتم تحديد سعر الأمبير للأشهر: ${missingMonths.join('، ')}`);
      return;
    }
    resetActivity();
    setGlobalLoading('جاري تسجيل الدفع...');
    try {
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
      const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
      const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
      const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
      const payerName = userRole === 'worker' ? workerName : ownerName;

      let newSubs = [...subscribers];
      for (const mk of selectedMonths) {
        const [m, y] = mk.split('_');
        const subIndex = newSubs.findIndex(s => s.id === sub.id);
        if (subIndex < 0) continue;
        const s = { ...newSubs[subIndex] };
        const price = getPriceForSubscriber(amperPrices, goldenPrices, mk, s.subscriptionType);
        const amperVal = getAmperForMonth(s, parseInt(m), parseInt(y));
        const monthDue = amperVal * price;

        const partialPayments = s.partialPayments ? { ...s.partialPayments } : {};
        const monthPayments = partialPayments[mk] ? [...partialPayments[mk]] : [];
        monthPayments.push({ amount: monthDue, timestamp, date: now.toISOString(), ownerName: payerName });
        partialPayments[mk] = monthPayments;

        const paidMonths = s.paidMonths ? { ...s.paidMonths } : {};
        paidMonths[mk] = true;

        const paymentHistory = [...(s.paymentHistory || []), {
          monthKey: mk, action: 'paid', timestamp, date: now.toISOString(), ownerName: payerName,
        }];

        newSubs[subIndex] = { ...s, partialPayments, paidMonths, paymentHistory };
      }

      setSubscribers(newSubs);
      if (userRole !== 'worker') {
        if (generators.length > 0) {
          const updated = generators.map(g => g.id === currentGeneratorId ? { ...g, subscribers: newSubs } : g);
          setGenerators(updated);
          if (currentUser) await saveUserData(currentUser, 'generators', updated);
        }
      }
      if (userRole === 'worker' && sub) {
        for (const mk of selectedMonths) {
          const [m, y] = mk.split('_');
          const price = getPriceForSubscriber(amperPrices, goldenPrices, mk, sub.subscriptionType);
          const amperVal = getAmperForMonth(sub, parseInt(m), parseInt(y));
          const monthDue = amperVal * price;
          trackWorkerUpdate('paid', sub.id, sub.name, sub.amper, mk, { amount: monthDue });
        }
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء الدفع');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleRestoreSubscriber = async (id) => {
    setGlobalLoading('جاري استرداد المشترك...');
    try {
      if (userRole === 'worker' && !workerPermissions.includes('delete')) return;
      const sub = subscribers.find(s => s.id === id);
      const newSubs = subscribers.map(s => {
        if (s.id === id) {
          const restored = { ...s };
          delete restored.deletedFromMonth;
          delete restored.deletedAt;
          delete restored.deletedByOwner;
          return restored;
        }
        return s;
      });
      setSubscribers(newSubs);
      if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('restore', id, sub.name, sub.amper, '');
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء استرداد المشترك');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleChangeAmper = async (id, newAmper, monthKey) => {
    setGlobalLoading('جاري تغيير الأمبير...');
    try {
      if (userRole === 'worker' && !workerPermissions.includes('amperPrice')) return;
      const sub = subscribers.find(s => s.id === id);
      const newSubs = subscribers.map(s => {
        if (s.id === id) {
          const amperHistory = s.amperHistory ? [...s.amperHistory] : [];
          const existingIndex = amperHistory.findIndex(h => h.monthKey === monthKey);
          if (existingIndex >= 0) {
            amperHistory[existingIndex] = { monthKey, amper: newAmper };
          } else {
            amperHistory.push({ monthKey, amper: newAmper });
          }
          amperHistory.sort((a, b) => {
            const [aM, aY] = a.monthKey.split('_').map(Number);
            const [bM, bY] = b.monthKey.split('_').map(Number);
            return aY - bY || aM - bM;
          });
          return { ...s, amperHistory };
        }
        return s;
      });
      setSubscribers(newSubs);
      if (currentUser && userRole !== 'worker') { await saveUserData(currentUser, 'subscribers', newSubs); await syncSubscribersToGenerator(newSubs); }
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('edit', id, sub.name, newAmper, monthKey, { amper: newAmper, oldAmper: sub.amper, oldAmperHistory: sub.amperHistory || [] });
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير الأمبير');
    } finally {
      setGlobalLoading('');
    }
  };

  useEffect(() => {
    const onBackPress = () => {
      if (showOnboarding) return false;
      if (screen === 'welcome' || screen === 'login' || screen === 'register' || screen === 'workerLogin') return false;

      if (workerSwitchGeneratorVisible) { setWorkerSwitchGeneratorVisible(false); return true; }
      if (changePassVisible) { setChangePassVisible(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); return true; }
      if (monthlyDataVisible) { setMonthlyDataVisible(false); return true; }
      if (updatesModalVisible) { setUpdatesModalVisible(false); return true; }
      if (settingsVisible) { setSettingsVisible(false); setActiveTab('home'); return true; }
      if (subscribersVisible) { setSubscribersVisible(false); return true; }
      if (reportsVisible) { setReportsVisible(false); return true; }
      if (workerExpenseVisible) { setWorkerExpenseVisible(false); return true; }
      if (workerTrackingVisible) { setWorkerTrackingVisible(false); return true; }
      if (activeTab !== 'home') { setActiveTab('home'); return true; }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [showOnboarding, screen, activeTab, settingsVisible, workerSwitchGeneratorVisible, monthlyDataVisible, updatesModalVisible, changePassVisible, reportsVisible, subscribersVisible, workerExpenseVisible]);

  if (showOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  if (isLoading) {
    return (
      <View style={styles.mainContainer}>
        <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="flash" size={60} color="#FFD700" />
          <Text style={{ color: '#333', fontSize: 18, marginTop: 20 }}>جاري التحميل...</Text>
        </View>
      </View>
    );
  }

  if (appLocked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0E1A', justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar backgroundColor="#0A0E1A" barStyle="light-content" />
        <TouchableOpacity style={{ alignItems: 'center', justifyContent: 'center', flex: 1, width: '100%' }} onPress={authenticateUser} activeOpacity={0.8}>
          <View style={{ width: 100, height: 100, borderRadius: 24, backgroundColor: 'rgba(255,215,0,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
            <Ionicons name="flash" size={60} color="#FFD700" />
          </View>
          <Text style={{ color: '#FFD700', fontSize: 28, fontWeight: 'bold', marginBottom: 30 }}>مولدي</Text>
          <Ionicons name="finger-print" size={60} color="#FFD700" />
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 16 }}>المس للمتابعة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (subscriptionData && subscriptionData.status === 'expired' && screen === 'main' && userRole !== 'worker') {
    return (
      <ExpiredScreen
        ownerName={ownerName}
        currentUser={currentUser}
        onActivate={() => { Linking.openURL('whatsapp://send?phone=9647802524458&text=' + encodeURIComponent('مرحباً، أريد تفعيل اشتراك تطبيق مولدي')).catch(function() { Alert.alert('خطأ', 'لم يتم فتح الواتساب'); }); }}
        onLogout={handleLogout}
        onCodeActivated={async function(subEnds) {
          var subData = { status: 'active', subscription_ends_at: subEnds, trial_ends_at: new Date().toISOString(), created_at: new Date().toISOString() };
          if (currentUser) await SecureStore.setItemAsync('subscription_' + currentUser, JSON.stringify(subData));
          setSubscriptionData({ status: 'active', daysLeft: 180, subscription_ends_at: subEnds });
        }}
      />
    );
  }

  if (subscriptionData && subscriptionData.status === 'expired' && userRole === 'worker' && (screen === 'main' || screen === 'workerMain')) {
    return (
      <WorkerExpiredScreen onLogout={handleLogout} />
    );
  }

  if (screen === 'welcome') {
    return (
      <WelcomeScreen
        onLogin={() => setScreen('login')}
        onRegister={() => setScreen('register')}
        onWorkerLogin={() => setScreen('workerLogin')}
      />
    );
  }

  if (screen === 'register') {
    return (
      <RegisterScreen
        onBack={() => setScreen('login')}
        onRegister={() => setScreen('login')}
        onRegisterSuccess={(registeredPhone, registeredName) => { setCurrentUser(registeredPhone); setUserRole('owner'); setOwnerName(registeredName || ''); SecureStore.setItemAsync('current_user', JSON.stringify({ phone: registeredPhone, role: 'owner' })); SecureStore.setItemAsync('registration_' + registeredPhone, new Date().toISOString()); setScreen('main'); setActiveTab('home'); checkSubscription(registeredPhone); }}
      />
    );
  }

  if (screen === 'login') {
    return (
      <LoginScreen
        onBack={() => setScreen('welcome')}
        onRegister={() => setScreen('register')}
        onLogin={handleLogin}
        onWorkerLogin={() => setScreen('workerLogin')}
      />
    );
  }

  if (screen === 'workerLogin') {
    return (
      <WorkerLoginScreen
        onBack={() => setScreen('login')}
        onLogin={async (code, pin) => {
          const net = await NetInfo.fetch();
          if (!net.isConnected) {
            Alert.alert('تنبيه', 'يجب الاتصال بالإنترنت لتسجيل الدخول');
            return;
          }
          const result = await handleWorkerLogin(code, pin);
          if (result.ownerExpired) {
            Alert.alert('اشتراك منتهي', 'اشتراك صاحب المولد منتهي. يرجى التواصل مع صاحب المولد لتجديد الاشتراك.');
            return;
          }
          if (result.success) {
            setWorkerOwnerPhone(result.ownerPhone);
            setUserRole('worker');
            setWorkerPermissions(result.permissions);
            setWorkerCode(code.toUpperCase());
            setWorkerName(result.savedName);
            setCurrentUser(result.ownerPhone);
            const assignedGens = result.assignedGenerators || [];
            setWorkerAssignedGenerators(assignedGens);
            await SecureStore.setItemAsync('current_user', JSON.stringify({
              phone: result.ownerPhone,
              role: 'worker',
              workerCode: code.toUpperCase(),
              workerName: result.savedName || '',
              permissions: result.permissions,
              assignedGeneratorId: result.assignedGeneratorId || null,
              assignedGenerators: assignedGens,
            }));
            const ownerData = await loadAllUserKeys(result.ownerPhone);
            const ownerGens = ownerData.generators || [];
            const assignedId = result.assignedGeneratorId;
            let targetGen = null;
            if (assignedId && ownerGens.length > 0) {
              targetGen = ownerGens.find(function(g) { return g.id === assignedId; });
            }
            if (!targetGen && ownerGens.length > 0) {
              targetGen = ownerGens[0];
            }
            if (targetGen) {
              setGenerators(ownerGens);
              setCurrentGeneratorId(targetGen.id);
              setWorkerAssignedGeneratorId(targetGen.id);
              setGeneratorName(targetGen.name);
              setSubscribers(targetGen.subscribers || []);
              setAmperPrices(targetGen.amperPrices || {});
              setGoldenPrices(targetGen.goldenPrices || {});
              setMonthlyExpenses(targetGen.monthlyExpenses || {});
            }
            setScreen('workerMain');
            checkSubscription(result.ownerPhone);
          }
          return result;
        }}
      />
    );
  }

  if (screen === 'workerMain' && userRole === 'worker') {
    if (appPartialPaymentVisible && appPartialPaymentSubscriber) {
      return (
        <View style={styles.mainContainer}>
          <PartialPaymentModal
            visible={appPartialPaymentVisible}
            onClose={() => { setAppPartialPaymentVisible(false); setAppPartialPaymentSubscriber(null); setAppPartialPaymentMonthKey(''); }}
            subscriber={appPartialPaymentSubscriber}
            amperPrices={amperPrices}
            goldenPrices={goldenPrices}
            monthKey={appPartialPaymentMonthKey}
            onConfirm={(amount) => { handlePartialPayment(appPartialPaymentSubscriber.id, amount, appPartialPaymentMonthKey); }}
            darkMode={darkMode}
          />
        </View>
      );
    }
    return (
      <View style={styles.mainContainer}>
        <LoadingOverlay visible={!!globalLoading} text={globalLoading} />
        {!reportsVisible && !subscribersVisible && !workerExpenseVisible && (
        <WorkerMainScreen
          generatorName={generatorName}
          onShowSubscribers={() => setSubscribersVisible(true)}
          onShowReports={() => setReportsVisible(true)}
          subscribers={subscribers}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          onLogout={handleLogout}
          isOnline={isOnline}
          workerUpdates={workerUpdates}
          onSync={handleWorkerSync}
          workerName={workerName}
          generators={generators}
          workerPermissions={workerPermissions}
          onSwitchGenerator={null}
          onShowWorkerSwitchGenerator={() => setWorkerSwitchGeneratorVisible(true)}
          workerAssignedGenerators={workerAssignedGenerators}
          onAddExpense={handleWorkerAddExpense}
          darkMode={darkMode}
          onShowExpense={() => setWorkerExpenseVisible(true)}
        />
        )}
        {reportsVisible && (
          <ReportsScreen
            fullScreen
            visible={true}
            onClose={() => setReportsVisible(false)}
            subscribers={subscribers}
            amperPrices={amperPrices}
            goldenPrices={goldenPrices}
          />
        )}
        {workerExpenseVisible && (
          <View style={styles.mainContainer}>
            <StatusBar backgroundColor="#FF5722" barStyle="light-content" />
            <View style={[styles.header, { backgroundColor: '#FF5722' }]}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={() => { setWorkerExpenseVisible(false); setWorkerExpenseType(''); setWorkerExpenseAmount(''); }}>
                  <Ionicons name="arrow-forward" size={24} color="white" />
                </TouchableOpacity>
              </View>
              <Text style={styles.headerTitle}>إضافة صرفية</Text>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              <View style={{ padding: 16 }}>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>نوع الصرفية <Text style={styles.required}>*</Text></Text>
                  <TextInput style={[styles.formInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={workerExpenseType} onChangeText={setWorkerExpenseType} placeholder="مثال: دهن، كاز، صيانة" placeholderTextColor="#999" textAlign="right" autoFocus />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>المبلغ <Text style={styles.required}>*</Text></Text>
                  <TextInput style={[styles.formInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={workerExpenseAmount ? formatNumber(parseInt(workerExpenseAmount.replace(/,/g, ''))) : ''} onChangeText={(t) => { const raw = t.replace(/[^0-9]/g, ''); setWorkerExpenseAmount(raw); }} placeholder="0" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
                </View>
                <TouchableOpacity style={[styles.saveSubscriberButton, { backgroundColor: '#FF5722' }]} onPress={handleSaveWorkerExpense}>
                  <Ionicons name="checkmark-circle" size={22} color="white" />
                  <Text style={styles.saveSubscriberText}>حفظ الصرفية</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
        <Modal visible={workerSwitchGeneratorVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: 16, padding: 24, width: MODAL_WIDTH, maxHeight: '70%' }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: darkMode ? '#fff' : '#333' }}>اختر المولد</Text>
                <TouchableOpacity onPress={() => setWorkerSwitchGeneratorVisible(false)}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
              </View>
              {generators.map(function(gen) {
                if (workerAssignedGenerators.indexOf(gen.id) < 0) return null;
                const isActive = gen.id === currentGeneratorId;
                return (
                  <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: isActive ? (darkMode ? '#2a3a4a' : '#E3F2FD') : 'transparent', borderRadius: isActive ? 8 : 0 }}                   onPress={async function() {
                    if (isActive) { setWorkerSwitchGeneratorVisible(false); return; }
                    try {
                      const freshData = await loadAllUserKeys(workerOwnerPhone);
                      const freshGens = freshData.generators || generators;
                      const freshGen = freshGens.find(function(g) { return g.id === gen.id; }) || gen;
                      setGenerators(freshGens);
                      setCurrentGeneratorId(freshGen.id);
                      setGeneratorName(freshGen.name);
                      setSubscribers(freshGen.subscribers || []);
                       setAmperPrices(freshGen.amperPrices || {});
                       setGoldenPrices(freshGen.goldenPrices || {});
                       setMonthlyExpenses(freshGen.monthlyExpenses || {});
                       setWorkerAssignedGeneratorId(freshGen.id);
                    } catch (e) {
                      setGenerators(generators);
                      setCurrentGeneratorId(gen.id);
                      setGeneratorName(gen.name);
                      setSubscribers(gen.subscribers || []);
                       setAmperPrices(gen.amperPrices || {});
                       setGoldenPrices(gen.goldenPrices || {});
                       setMonthlyExpenses(gen.monthlyExpenses || {});
                       setWorkerAssignedGeneratorId(gen.id);
                    }
                    setWorkerSwitchGeneratorVisible(false);
                  }}>
                    <Ionicons name={isActive ? 'radio-button-on' : 'radio-button-off'} size={22} color={isActive ? '#2196F3' : '#999'} style={{ marginLeft: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: isActive ? 'bold' : 'normal', color: darkMode ? '#fff' : '#333' }}>{gen.name}</Text>
                      <Text style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{(gen.subscribers || []).length} مشترك</Text>
                    </View>
                    {isActive && <Ionicons name="checkmark-circle" size={22} color="#2196F3" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Modal>
        {subscribersVisible && (
        <SubscribersScreen
          fullScreen
          visible={true}
          onClose={() => setSubscribersVisible(false)}
          subscribers={subscribers}
          onSaveSubscriber={handleAddSubscriber}
          onDeleteSubscriber={handleDeleteSubscriber}
          onTogglePaid={handleTogglePaid}
          onPartialPayment={handlePartialPayment}
          onRestoreSubscriber={handleRestoreSubscriber}
          onChangeAmper={handleChangeAmper}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          onSaveGoldenPrice={saveGoldenPrice}
          onSaveAmperPrice={saveAmperPrice}
          currentUser={currentUser}
          ownerName={ownerName}
          userRole={userRole}
          workerPermissions={workerPermissions}
          darkMode={darkMode}
          lastMonth={lastSubscribersMonth}
          lastYear={lastSubscribersYear}
          onSaveLastMonth={(m, y) => { setLastSubscribersMonth(m); setLastSubscribersYear(y); if (currentUser) { saveUserData(currentUser, 'lastSubscribersMonth', m); saveUserData(currentUser, 'lastSubscribersYear', y); } }}
          onOpenPartialPayment={(sub, mk) => { setSubscribersVisible(false); setAppPartialPaymentSubscriber(sub); setAppPartialPaymentMonthKey(mk); setAppPartialPaymentVisible(true); }}
          onMultiMonthPayment={(sub) => { setMultiMonthPaymentSubscriber(sub); setMultiMonthPaymentVisible(true); }}
          onOpenMultiMonthPayment={() => { setSubscribersVisible(false); setActiveTab('home'); setMultiMonthPaymentVisible(true); }}
        />
        )}
      </View>
    );
  }

  if (userRole === 'worker') {
    if (appPartialPaymentVisible && appPartialPaymentSubscriber) {
      return (
        <View style={styles.mainContainer}>
          <PartialPaymentModal
            visible={appPartialPaymentVisible}
            onClose={() => { setAppPartialPaymentVisible(false); setAppPartialPaymentSubscriber(null); setAppPartialPaymentMonthKey(''); }}
            subscriber={appPartialPaymentSubscriber}
            amperPrices={amperPrices}
            goldenPrices={goldenPrices}
            monthKey={appPartialPaymentMonthKey}
            onConfirm={(amount) => { handlePartialPayment(appPartialPaymentSubscriber.id, amount, appPartialPaymentMonthKey); }}
            darkMode={darkMode}
          />
        </View>
      );
    }
    return (
      <View style={styles.mainContainer}>
        {!reportsVisible && !subscribersVisible && !workerExpenseVisible && (
        <WorkerMainScreen
          generatorName={generatorName}
          onShowSubscribers={() => setSubscribersVisible(true)}
          onShowReports={() => setReportsVisible(true)}
          subscribers={subscribers}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          onLogout={handleLogout}
          isOnline={isOnline}
          workerUpdates={workerUpdates}
          onSync={handleWorkerSync}
          workerName={workerName}
          generators={generators}
          workerPermissions={workerPermissions}
          onSwitchGenerator={null}
          onShowWorkerSwitchGenerator={() => setWorkerSwitchGeneratorVisible(true)}
          workerAssignedGenerators={workerAssignedGenerators}
          onAddExpense={handleWorkerAddExpense}
          darkMode={darkMode}
          onShowExpense={() => setWorkerExpenseVisible(true)}
        />
        )}
        {reportsVisible && (
          <ReportsScreen
            fullScreen
            visible={true}
            onClose={() => setReportsVisible(false)}
            subscribers={subscribers}
            amperPrices={amperPrices}
            goldenPrices={goldenPrices}
          />
        )}
        {workerExpenseVisible && (
          <View style={styles.mainContainer}>
            <StatusBar backgroundColor="#FF5722" barStyle="light-content" />
            <View style={[styles.header, { backgroundColor: '#FF5722' }]}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={() => { setWorkerExpenseVisible(false); setWorkerExpenseType(''); setWorkerExpenseAmount(''); }}>
                  <Ionicons name="arrow-forward" size={24} color="white" />
                </TouchableOpacity>
              </View>
              <Text style={styles.headerTitle}>إضافة صرفية</Text>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              <View style={{ padding: 16 }}>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>نوع الصرفية <Text style={styles.required}>*</Text></Text>
                  <TextInput style={[styles.formInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={workerExpenseType} onChangeText={setWorkerExpenseType} placeholder="مثال: دهن، كاز، صيانة" placeholderTextColor="#999" textAlign="right" autoFocus />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>المبلغ <Text style={styles.required}>*</Text></Text>
                  <TextInput style={[styles.formInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={workerExpenseAmount ? formatNumber(parseInt(workerExpenseAmount.replace(/,/g, ''))) : ''} onChangeText={(t) => { const raw = t.replace(/[^0-9]/g, ''); setWorkerExpenseAmount(raw); }} placeholder="0" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
                </View>
                <TouchableOpacity style={[styles.saveSubscriberButton, { backgroundColor: '#FF5722' }]} onPress={handleSaveWorkerExpense}>
                  <Ionicons name="checkmark-circle" size={22} color="white" />
                  <Text style={styles.saveSubscriberText}>حفظ الصرفية</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
        {subscribersVisible && (
        <SubscribersScreen
          fullScreen
          visible={true}
          onClose={() => setSubscribersVisible(false)}
          subscribers={subscribers}
          onSaveSubscriber={handleAddSubscriber}
          onDeleteSubscriber={handleDeleteSubscriber}
          onTogglePaid={handleTogglePaid}
          onPartialPayment={handlePartialPayment}
          onRestoreSubscriber={handleRestoreSubscriber}
          onChangeAmper={handleChangeAmper}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          onSaveGoldenPrice={saveGoldenPrice}
          onSaveAmperPrice={saveAmperPrice}
          currentUser={currentUser}
          ownerName={ownerName}
          userRole={userRole}
          workerPermissions={workerPermissions}
          darkMode={darkMode}
          lastMonth={lastSubscribersMonth}
          lastYear={lastSubscribersYear}
          onSaveLastMonth={(m, y) => { setLastSubscribersMonth(m); setLastSubscribersYear(y); if (currentUser) { saveUserData(currentUser, 'lastSubscribersMonth', m); saveUserData(currentUser, 'lastSubscribersYear', y); } }}
          onOpenPartialPayment={(sub, mk) => { setSubscribersVisible(false); setAppPartialPaymentSubscriber(sub); setAppPartialPaymentMonthKey(mk); setAppPartialPaymentVisible(true); }}
          onMultiMonthPayment={(sub) => { setMultiMonthPaymentSubscriber(sub); setMultiMonthPaymentVisible(true); }}
          onOpenMultiMonthPayment={() => { setSubscribersVisible(false); setActiveTab('home'); setMultiMonthPaymentVisible(true); }}

        />
        )}
        <Modal visible={workerSwitchGeneratorVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: 16, padding: 24, width: MODAL_WIDTH, maxHeight: '70%' }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: darkMode ? '#fff' : '#333' }}>اختر المولد</Text>
                <TouchableOpacity onPress={() => setWorkerSwitchGeneratorVisible(false)}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
              </View>
              {generators.map(function(gen) {
                if (workerAssignedGenerators.indexOf(gen.id) < 0) return null;
                const isActive = gen.id === currentGeneratorId;
                return (
                  <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: isActive ? (darkMode ? '#2a3a4a' : '#E3F2FD') : 'transparent', borderRadius: isActive ? 8 : 0 }}                   onPress={async function() {
                    if (isActive) { setWorkerSwitchGeneratorVisible(false); return; }
                    try {
                      const freshData = await loadAllUserKeys(workerOwnerPhone);
                      const freshGens = freshData.generators || generators;
                      const freshGen = freshGens.find(function(g) { return g.id === gen.id; }) || gen;
                      setGenerators(freshGens);
                      setCurrentGeneratorId(freshGen.id);
                      setGeneratorName(freshGen.name);
                      setSubscribers(freshGen.subscribers || []);
                       setAmperPrices(freshGen.amperPrices || {});
                       setGoldenPrices(freshGen.goldenPrices || {});
                       setMonthlyExpenses(freshGen.monthlyExpenses || {});
                       setWorkerAssignedGeneratorId(freshGen.id);
                    } catch (e) {
                      setGenerators(generators);
                      setCurrentGeneratorId(gen.id);
                      setGeneratorName(gen.name);
                      setSubscribers(gen.subscribers || []);
                       setAmperPrices(gen.amperPrices || {});
                       setGoldenPrices(gen.goldenPrices || {});
                       setMonthlyExpenses(gen.monthlyExpenses || {});
                       setWorkerAssignedGeneratorId(gen.id);
                    }
                    setWorkerSwitchGeneratorVisible(false);
                  }}>
                    <Ionicons name={isActive ? 'radio-button-on' : 'radio-button-off'} size={22} color={isActive ? '#2196F3' : '#999'} style={{ marginLeft: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: isActive ? 'bold' : 'normal', color: darkMode ? '#fff' : '#333' }}>{gen.name}</Text>
                      <Text style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{(gen.subscribers || []).length} مشترك</Text>
                    </View>
                    {isActive && <Ionicons name="checkmark-circle" size={22} color="#2196F3" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  if (appPartialPaymentVisible && appPartialPaymentSubscriber) {
    return (
      <View style={styles.mainContainer}>
        <PartialPaymentModal
          visible={appPartialPaymentVisible}
          onClose={() => { setAppPartialPaymentVisible(false); setAppPartialPaymentSubscriber(null); setAppPartialPaymentMonthKey(''); }}
          subscriber={appPartialPaymentSubscriber}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          monthKey={appPartialPaymentMonthKey}
          onConfirm={(amount) => { handlePartialPayment(appPartialPaymentSubscriber.id, amount, appPartialPaymentMonthKey); }}
          darkMode={darkMode}
        />
      </View>
    );
  }

  return (
    <NotificationProvider>
    <View style={styles.mainContainer}>
      <AppNotification />
      <LoadingOverlay visible={!!globalLoading} text={globalLoading} />

      {monthlyDataVisible ? (
        <MonthlyDataScreen
          visible={monthlyDataVisible}
          onClose={() => setMonthlyDataVisible(false)}
          subscribers={subscribers}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          monthlyExpenses={monthlyExpenses}
          workerExpenses={workerExpenses}
          onSetExpenses={handleSetMonthlyExpenses}
        />
      ) : (<>
      {activeTab === 'home' && (
        <MainScreen
          currentUser={currentUser}
          generatorName={generatorName}
          onOpenSettings={() => { setSettingsVisible(true); setActiveTab('more'); }}
          onShowSubscribers={() => { setSubscribersVisible(true); setActiveTab('subscribers'); }}
          onShowReports={() => { setReportsVisible(true); setActiveTab('reports'); }}
          subscribers={subscribers}
          amperPrices={amperPrices}
          onSetAmperPrice={saveAmperPrice}
          goldenPrices={goldenPrices}
          onSetGoldenPrice={saveGoldenPrice}
          expenses={expenses}
          workerExpenses={(workerExpenses[currentMonthKeyForMain] || [])}
          onSetExpenses={saveExpenses}
          onLogout={handleLogout}
          isOnline={isOnline}
          generators={generators}
          onShowMonthlyData={() => setMonthlyDataVisible(true)}
          darkMode={darkMode}
          pendingUpdatesCount={pendingWorkerUpdates.length}
          onShowWorkerTracking={() => { setWorkerTrackingVisible(true); setActiveTab('workers'); }}
          workers={workers}
          onDeleteWorkerExpense={handleDeleteWorkerExpense}
          subscriptionData={subscriptionData}

        />
      )}

      {activeTab === 'subscribers' && !appPartialPaymentVisible && (
        <SubscribersScreen
          fullScreen
          visible={true}
          onClose={() => setActiveTab('home')}
          subscribers={subscribers}
          onSaveSubscriber={handleAddSubscriber}
          onDeleteSubscriber={handleDeleteSubscriber}
          onTogglePaid={handleTogglePaid}
          onPartialPayment={handlePartialPayment}
          onRestoreSubscriber={handleRestoreSubscriber}
          onChangeAmper={handleChangeAmper}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          onSaveGoldenPrice={saveGoldenPrice}
          onSaveAmperPrice={saveAmperPrice}
          currentUser={currentUser}
          ownerName={ownerName}
          userRole={userRole}
          workerPermissions={workerPermissions}
          darkMode={darkMode}
          lastMonth={lastSubscribersMonth}
          lastYear={lastSubscribersYear}
          onSaveLastMonth={(m, y) => { setLastSubscribersMonth(m); setLastSubscribersYear(y); if (currentUser) { saveUserData(currentUser, 'lastSubscribersMonth', m); saveUserData(currentUser, 'lastSubscribersYear', y); } }}
          onOpenPartialPayment={(sub, mk) => { setSubscribersVisible(false); setAppPartialPaymentSubscriber(sub); setAppPartialPaymentMonthKey(mk); setAppPartialPaymentVisible(true); }}
          onMultiMonthPayment={(sub) => { setMultiMonthPaymentSubscriber(sub); setMultiMonthPaymentVisible(true); }}
          onOpenMultiMonthPayment={() => { setSubscribersVisible(false); setActiveTab('home'); setMultiMonthPaymentVisible(true); }}

        />
      )}

      {activeTab === 'reports' && (
        <ReportsScreen
          fullScreen
          visible={true}
          onClose={() => setActiveTab('home')}
          subscribers={subscribers}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}

        />
      )}

      {activeTab === 'workers' && !editWorkerModalVisible && !addWorkerModalVisible && (
        <WorkerTrackingScreen
          fullScreen
          visible={true}
          onClose={() => setActiveTab('home')}
          workers={workers}
          activityLog={workerActivityLog}
          amperPrices={amperPrices}
          pendingWorkerUpdates={pendingWorkerUpdates}
          onApplyBatch={handleApplyBatch}
          onDeleteBatch={handleDeleteBatch}
          rejectedBatches={workerActivityLog.filter(b => b.status === 'rejected')}
          currentUser={currentUser}
          onAddWorker={() => setAddWorkerModalVisible(true)}
          onEditWorker={() => setEditWorkerModalVisible(true)}

        />
      )}

      {activeTab === 'generators' && (
        <GeneratorsScreen
          visible={true}
          onClose={() => setActiveTab('home')}
          generators={generators}
          currentGeneratorId={currentGeneratorId}
          onSwitchGenerator={handleSwitchGenerator}
          onAddGenerator={handleCreateGenerator}
          onDeleteGenerator={handleDeleteGenerator}
          subscribers={subscribers}
          amperPrices={amperPrices}
          goldenPrices={goldenPrices}
          monthlyExpenses={monthlyExpenses}
          workerExpenses={workerExpenses}
          darkMode={darkMode}
          currentUser={currentUser}
          deletedGenerators={deletedGenerators}
          onRestoreGenerator={handleRestoreGenerator}
        />
      )}

      <SettingsScreen
        visible={(activeTab === 'more' || settingsVisible) && !changePassVisible}
        onClose={() => { setSettingsVisible(false); setActiveTab('home'); }}
        generatorName={generatorName}
        onSaveGeneratorName={saveGeneratorName}
        ownerName={ownerName}
        onSaveOwnerName={saveOwnerName}
        onCreateWorker={handleCreateWorker}
        pendingWorkerUpdates={pendingWorkerUpdates}
        onLoadUpdates={loadPendingUpdates}
        workers={workers}
        onUpdateWorker={handleUpdateWorker}
        onDeleteWorker={handleDeleteWorker}
        onShowUpdates={() => setUpdatesModalVisible(true)}
        onLogout={handleLogout}
        darkMode={darkMode}
        onToggleDarkMode={async () => {
          const newVal = !darkMode;
          setDarkMode(newVal);
          if (currentUser) await saveUserData(currentUser, 'darkMode', newVal);
        }}
        newWorkerCredentials={newWorkerCredentials}
        onDismissCredentials={() => setNewWorkerCredentials(null)}
        generators={generators}
        onDeleteGenerator={handleDeleteGenerator}
        onRestoreGenerator={handleRestoreGenerator}
        deletedGenerators={deletedGenerators}
        currentGeneratorId={currentGeneratorId}
        onChangePassword={handleChangePassword}
        currentUser={currentUser}
        onChangePassVisible={() => setChangePassVisible(true)}
      />

      {addWorkerModalVisible && (
        <AddWorkerScreen
          visible={addWorkerModalVisible}
          onClose={() => { setAddWorkerModalVisible(false); setAddWorkerPerms([]); setAddWorkerAssignedGens([]); setAddWorkerName(''); }}
          generators={generators}
          darkMode={darkMode}
          currentUser={currentUser}
          onConfirmCreate={handleConfirmCreateWorker}
        />
      )}

      {editWorkerModalVisible && (
        <EditWorkerScreen
          visible={editWorkerModalVisible}
          onClose={() => { setEditWorkerModalVisible(false); setEditWorkerSel(null); setEditWorkerPerms([]); setEditWorkerAssignedGens([]); }}
          workers={workers}
          generators={generators}
          onUpdateWorker={handleUpdateWorker}
          onDeleteWorker={handleDeleteWorker}
          onResetWorkerPin={handleResetWorkerPin}
          darkMode={darkMode}
          currentUser={currentUser}
        />
      )}

      {changePassVisible && (
        <View style={styles.subscribersOverlay}>
          <View style={styles.subscribersContainer}>
            <View style={styles.subscribersHeader}>
              <TouchableOpacity onPress={() => { setChangePassVisible(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); }} style={styles.backButton}>
                <Ionicons name="arrow-forward" size={26} color="white" />
              </TouchableOpacity>
              <Text style={styles.subscribersTitle}>تغيير رمز الحساب</Text>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView style={styles.subscribersContent} showsVerticalScrollIndicator={false}>
              <View style={{ padding: IS_SMALL ? 16 : 20 }}>
                <Text style={{ fontSize: IS_SMALL ? 13 : 15, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: IS_SMALL ? 16 : 20 }}>أدخل الرمز الحالي ثم الرمز الجديد</Text>

                <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: IS_SMALL ? 12 : 16, padding: IS_SMALL ? 16 : 20, marginBottom: IS_SMALL ? 16 : 20 }}>
                  <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#555', marginBottom: 6, textAlign: 'right' }}>الرمز الحالي</Text>
                  <TextInput style={[styles.settingsInput, { textAlign: 'center', textAlignVertical: 'center' }]} placeholder="الرمز الحالي" placeholderTextColor="#999" value={currentPass} onChangeText={setCurrentPass} secureTextEntry maxLength={20} allowFontScaling={false} />

                  <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#555', marginBottom: 6, marginTop: IS_SMALL ? 12 : 16, textAlign: 'right' }}>الرمز الجديد</Text>
                  <TextInput style={[styles.settingsInput, { textAlign: 'center', textAlignVertical: 'center' }]} placeholder="الرمز الجديد (6 أحرف على الأقل)" placeholderTextColor="#999" value={newPass} onChangeText={(t) => setNewPass(t.replace(/[\u0600-\u06FF]/g, ''))} secureTextEntry maxLength={20} allowFontScaling={false} />

                  <Text style={{ fontSize: IS_SMALL ? 12 : 14, color: darkMode ? '#aaa' : '#555', marginBottom: 6, marginTop: IS_SMALL ? 12 : 16, textAlign: 'right' }}>تأكيد الرمز الجديد</Text>
                  <TextInput style={[styles.settingsInput, { textAlign: 'center', textAlignVertical: 'center' }]} placeholder="أعد إدخال الرمز الجديد" placeholderTextColor="#999" value={confirmPass} onChangeText={(t) => setConfirmPass(t.replace(/[\u0600-\u06FF]/g, ''))} secureTextEntry maxLength={20} allowFontScaling={false} />
                </View>

                <TouchableOpacity
                  style={{ backgroundColor: '#9C27B0', borderRadius: IS_SMALL ? 8 : 12, paddingVertical: IS_SMALL ? 12 : 16, width: '100%', alignItems: 'center', opacity: currentPass && newPass && confirmPass ? 1 : 0.5 }}
                  disabled={!currentPass || !newPass || !confirmPass}
                  onPress={async () => {
                    if (!currentPass.trim()) { Alert.alert('تنبيه', 'أدخل الرمز الحالي'); return; }
                    if (newPass.trim().length < 6) { Alert.alert('تنبيه', 'الرمز الجديد يجب أن يكون 6 أحرف على الأقل'); return; }
                    if (newPass.trim() !== confirmPass.trim()) { Alert.alert('تنبيه', 'الرمز الجديد غير متطابق'); return; }
                    if (currentPass.trim() === newPass.trim()) { Alert.alert('تنبيه', 'الرمز الجديد نفس الرمز الحالي'); return; }
                    if (/[\u0600-\u06FF]/.test(newPass)) { Alert.alert('تنبيه', 'الرمز يجب أن يكون أرقام أو حروف إنجليزية فقط'); return; }
                    const success = await handleChangePassword(currentPass.trim(), newPass.trim());
                    if (success) {
                      setCurrentPass('');
                      setNewPass('');
                      setConfirmPass('');
                      Alert.alert('تم', 'تم تغيير رمز الحساب بنجاح', [{ text: 'حسناً', onPress: () => setChangePassVisible(false) }]);
                    } else {
                      Alert.alert('خطأ', 'الرمز الحالي غير صحيح');
                    }
                  }}
                >
                  <Text style={{ color: 'white', fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold' }}>تغيير الرمز</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      </>)}

      {multiMonthPaymentVisible && (
        <Modal visible={multiMonthPaymentVisible} animationType="slide" onRequestClose={() => setMultiMonthPaymentVisible(false)}>
          <MultiMonthPaymentScreen
            visible={multiMonthPaymentVisible}
            onClose={() => setMultiMonthPaymentVisible(false)}
            subscribers={subscribers}
            amperPrices={amperPrices}
            goldenPrices={goldenPrices}
            onConfirm={handleMultiMonthPayment}
          />
        </Modal>
      )}

      {!monthlyDataVisible && !editWorkerModalVisible && !addWorkerModalVisible && !changePassVisible && !multiMonthPaymentVisible && (
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
        <TouchableOpacity style={styles.tabItem} onPress={() => { setActiveTab('home'); }}>
          <Ionicons name={activeTab === 'home' ? 'home' : 'home-outline'} size={24} color={activeTab === 'home' ? '#2196F3' : '#999'} />
          <Text style={[styles.tabLabel, { color: activeTab === 'home' ? '#2196F3' : '#999' }]}>الرئيسية</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => { setActiveTab('subscribers'); }}>
          <Ionicons name={activeTab === 'subscribers' ? 'people' : 'people-outline'} size={24} color={activeTab === 'subscribers' ? '#2196F3' : '#999'} />
          <Text style={[styles.tabLabel, { color: activeTab === 'subscribers' ? '#2196F3' : '#999' }]}>المشتركين</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => { setActiveTab('workers'); }}>
          <Ionicons name={activeTab === 'workers' ? 'briefcase' : 'briefcase-outline'} size={24} color={activeTab === 'workers' ? '#2196F3' : '#999'} />
          <Text style={[styles.tabLabel, { color: activeTab === 'workers' ? '#2196F3' : '#999' }]}>العمال</Text>
          {pendingWorkerUpdates.length > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{pendingWorkerUpdates.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => { setActiveTab('reports'); }}>
          <Ionicons name={activeTab === 'reports' ? 'bar-chart' : 'bar-chart-outline'} size={24} color={activeTab === 'reports' ? '#2196F3' : '#999'} />
          <Text style={[styles.tabLabel, { color: activeTab === 'reports' ? '#2196F3' : '#999' }]}>التقارير</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('generators')}>
          <Ionicons name={activeTab === 'generators' ? 'flash' : 'flash-outline'} size={24} color={activeTab === 'generators' ? '#2196F3' : '#999'} />
          <Text style={[styles.tabLabel, { color: activeTab === 'generators' ? '#2196F3' : '#999' }]}>المولدات</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => { setSettingsVisible(true); setActiveTab('more'); }}>
          <Ionicons name={activeTab === 'more' ? 'ellipsis-horizontal' : 'ellipsis-horizontal-outline'} size={24} color={activeTab === 'more' ? '#2196F3' : '#999'} />
          <Text style={[styles.tabLabel, { color: activeTab === 'more' ? '#2196F3' : '#999' }]}>الاعدادات</Text>
        </TouchableOpacity>
      </View>
      )}
    </View>
    </NotificationProvider>
  );
}

const styles = StyleSheet.create({
  welcomeContainer: {
    flex: 1,
    backgroundColor: '#1565C0',
  },
  welcomeContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: IS_SMALL ? 20 : IS_TABLET ? 40 : 30,
    maxWidth: IS_TABLET ? 500 : '100%',
    alignSelf: 'center',
    width: '100%',
  },
  welcomeLogo: {
    alignItems: 'center',
    marginBottom: IS_SMALL ? 40 : IS_TABLET ? 80 : 60,
  },
  welcomeTitle: {
    fontSize: IS_SMALL ? 32 : IS_TABLET ? 52 : 42,
    fontWeight: 'bold',
    color: 'white',
    marginTop: IS_SMALL ? 12 : IS_TABLET ? 20 : 16,
  },
  welcomeSubtitle: {
    fontSize: IS_SMALL ? 14 : IS_TABLET ? 18 : 16,
    color: 'rgba(255,255,255,0.8)',
    marginTop: IS_SMALL ? 6 : IS_TABLET ? 12 : 8,
  },
  welcomeLoginBtn: {
    backgroundColor: '#2196F3',
    borderRadius: IS_SMALL ? 10 : IS_TABLET ? 14 : 12,
    paddingVertical: IS_SMALL ? 14 : IS_TABLET ? 22 : 18,
    alignItems: 'center',
    width: '100%',
    marginBottom: IS_SMALL ? 12 : IS_TABLET ? 20 : 16,
  },
  welcomeLoginText: {
    color: 'white',
    fontSize: IS_SMALL ? 16 : IS_TABLET ? 22 : 18,
    fontWeight: 'bold',
  },
  welcomeRegisterBtn: {
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: IS_SMALL ? 10 : IS_TABLET ? 14 : 12,
    paddingVertical: IS_SMALL ? 14 : IS_TABLET ? 22 : 18,
    alignItems: 'center',
    width: '100%',
  },
  welcomeRegisterText: {
    color: 'white',
    fontSize: IS_SMALL ? 16 : IS_TABLET ? 22 : 18,
    fontWeight: 'bold',
  },

  loginContainer: {
    flex: 1,
    backgroundColor: '#1565C0',
  },
  loginScrollContent: {
    flexGrow: 1,
    paddingHorizontal: IS_SMALL ? 20 : IS_TABLET ? 40 : 30,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingBottom: IS_SMALL ? 24 : IS_TABLET ? 50 : 40,
    maxWidth: IS_TABLET ? 500 : '100%',
    alignSelf: 'center',
    width: '100%',
  },
  loginContent: {
    flex: 1,
    paddingHorizontal: IS_SMALL ? 20 : IS_TABLET ? 40 : 30,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    maxWidth: IS_TABLET ? 500 : '100%',
    alignSelf: 'center',
    width: '100%',
  },
  backBtn: {
    alignSelf: 'flex-end',
    padding: IS_SMALL ? 6 : 8,
    marginBottom: IS_SMALL ? 8 : 12,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: IS_SMALL ? 20 : IS_TABLET ? 40 : 30,
  },
  appTitle: {
    fontSize: IS_SMALL ? 24 : 32,
    fontWeight: 'bold',
    color: 'white',
    marginTop: IS_SMALL ? 8 : 12,
  },
  loginCard: {
    backgroundColor: 'white',
    borderRadius: IS_SMALL ? 16 : IS_TABLET ? 24 : 20,
    padding: IS_SMALL ? 16 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: IS_SMALL ? 10 : 12,
    paddingHorizontal: IS_SMALL ? 12 : 16,
    marginBottom: IS_SMALL ? 10 : 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  inputIcon: {
    marginRight: IS_SMALL ? 8 : 12,
  },
  input: {
    flex: 1,
    paddingVertical: IS_SMALL ? 12 : 16,
    fontSize: IS_SMALL ? 14 : 16,
    color: '#333',
  },
  loginButton: {
    backgroundColor: '#2196F3',
    borderRadius: IS_SMALL ? 10 : 12,
    paddingVertical: IS_SMALL ? 12 : 16,
    alignItems: 'center',
    marginTop: IS_SMALL ? 4 : 6,
    marginBottom: IS_SMALL ? 10 : 16,
  },
  loginButtonText: {
    color: 'white',
    fontSize: IS_SMALL ? 15 : 18,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#2196F3',
    fontSize: IS_SMALL ? 12 : 14,
    textAlign: 'center',
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: IS_TABLET ? 'center' : 'flex-end',
    alignItems: IS_TABLET ? 'center' : 'stretch',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: IS_TABLET ? 20 : 20,
    borderTopRightRadius: IS_TABLET ? 20 : 20,
    borderBottomLeftRadius: IS_TABLET ? 20 : 0,
    borderBottomRightRadius: IS_TABLET ? 20 : 0,
    paddingBottom: 40,
    width: IS_TABLET ? MODAL_WIDTH : '100%',
    maxHeight: IS_TABLET ? '80%' : '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2196F3',
  },
  settingsBody: {
    padding: 20,
  },
  settingsLabel: {
    fontSize: IS_SMALL ? 14 : 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
    textAlign: 'right',
  },
  settingsInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
  },
  settingsHint: {
    fontSize: 13,
    color: '#999',
    marginTop: 6,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 20,
  },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: IS_TABLET ? 'center' : 'flex-end',
    alignItems: IS_TABLET ? 'center' : 'stretch',
  },
  pickerContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: IS_TABLET ? 20 : 20,
    borderTopRightRadius: IS_TABLET ? 20 : 20,
    borderBottomLeftRadius: IS_TABLET ? 20 : 0,
    borderBottomRightRadius: IS_TABLET ? 20 : 0,
    paddingBottom: 40,
    maxHeight: IS_TABLET ? '60%' : '60%',
    width: IS_TABLET ? MODAL_WIDTH : '100%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  pickerList: {
    paddingHorizontal: 16,
  },
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  pickerItemSelected: {
    backgroundColor: '#E3F2FD',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  pickerItemText: {
    fontSize: 17,
    color: '#333',
  },
  pickerItemTextSelected: {
    color: '#2196F3',
    fontWeight: 'bold',
  },

  addSubscriberOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  addSubscriberModalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    paddingBottom: 20,
    width: '88%',
    maxHeight: '80%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  addSubscriberBody: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    textAlign: 'right',
  },
  required: {
    color: '#D32F2F',
  },
  formInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  subscriptionTypeBtn: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  subscriptionTypeBtnActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  subscriptionTypeBtnActiveGold: {
    backgroundColor: '#FFF8E1',
    borderColor: '#FFD700',
  },
  subscriptionTypeBtnText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  subscriptionTypeBtnTextActive: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
  subscriptionTypeBtnTextActiveGold: {
    color: '#FF8F00',
    fontWeight: 'bold',
  },
  goldenBadge: {
    backgroundColor: '#FFD700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  goldenBadgeText: {
    fontSize: 10,
    color: '#5D4037',
    fontWeight: 'bold',
  },
  saveSubscriberButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  saveSubscriberText: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
  },
  modalButton: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
  },
  subscriberInfo: {
    flex: 1,
    marginLeft: 12,
  },

  subscribersOverlay: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  subscribersContainer: {
    flex: 1,
  },
  subscribersHeader: {
    backgroundColor: '#2196F3',
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingBottom: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
  },
  subscribersTitle: {
    color: 'white',
    fontSize: IS_SMALL ? 17 : 22,
    fontWeight: 'bold',
  },
  subscribersContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  dateSelectors: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  dateDropdown: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  dateDropdownText: {
    fontSize: 16,
    color: '#333',
  },
  addSubscriberButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 18,
    marginTop: 16,
    alignItems: 'center',
  },
  addSubscriberText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  subscriberButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  addSubscriberButtonHalf: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
  },
  deleteSubscriberButtonHalf: {
    backgroundColor: '#D32F2F',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
  },
  deleteSubscriberText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  searchContainer: {
    marginTop: 16,
  },
  searchInput: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterTabs: {
    flexDirection: 'row',
    marginTop: 16,
  },
  filterTab: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
  },
  filterTabAll: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  filterTabAllActive: {
    backgroundColor: '#2196F3',
  },
  filterTabUnpaid: {
    backgroundColor: '#FFEBEE',
    borderColor: '#D32F2F',
  },
  filterTabUnpaidActive: {
    backgroundColor: '#D32F2F',
  },
  filterTabRequired: {
    backgroundColor: '#FFF3E0',
    borderColor: '#FF9800',
  },
  filterTabRequiredActive: {
    backgroundColor: '#FF9800',
  },
  filterTabPaid: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
  },
  filterTabPaidActive: {
    backgroundColor: '#4CAF50',
  },
  filterTabDeleted: {
    backgroundColor: '#ECEFF1',
    borderColor: '#90A4AE',
  },
  filterTabDeletedActive: {
    backgroundColor: '#90A4AE',
  },
  filterTabText: {
    fontSize: IS_SMALL ? 9 : 11,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    lineHeight: IS_SMALL ? 13 : 16,
  },
  activeFilterTabText: {
    color: 'white',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingBottom: 100,
  },
  emptyStateText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
  subscriberCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: IS_SMALL ? 8 : 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  paidCardBorder: {
    borderColor: '#4CAF50',
    backgroundColor: '#F1F8E9',
  },
  unpaidCardBorder: {
    borderColor: '#E8E8E8',
  },
  deletedCard: {
    borderColor: '#90A4AE',
    opacity: 0.7,
  },
  cardTopRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  cardNameSection: {
    flex: 1,
    alignItems: 'flex-end',
  },
  cardPriceSection: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  cardPrice: {
    fontSize: IS_SMALL ? 14 : 16,
    fontWeight: 'bold',
    color: '#333',
  },
  cardPartialRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  cardBottomRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  cardBottomRight: {
    alignItems: 'flex-end',
  },
  cardBottomLeft: {
    alignItems: 'flex-start',
  },
subscriberName: {
    fontSize: IS_SMALL ? 13 : 15,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'right',
},
  subscriberAmperTag: {
    fontSize: IS_SMALL ? 11 : 13,
    color: '#2196F3',
    fontWeight: '600',
    marginTop: 2,
  },
  editableName: {
    color: '#2196F3',
    textDecorationLine: 'underline',
  },
  offlineBanner: {
    backgroundColor: '#FF5722',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  offlineBannerText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  loadMoreButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginVertical: 10,
    marginHorizontal: 20,
    backgroundColor: '#F0F8FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  loadMoreText: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: '600',
    marginLeft: 6,
  },
  subscriberAmount: {
    fontSize: 13,
    color: '#666',
    textAlign: 'right',
  },
  amperBlue: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
  payCheckbox: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxPaid: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxUnpaid: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ccc',
    backgroundColor: 'white',
  },
  checkEmoji: {
    fontSize: 24,
  },
  restoreButton: {
    padding: 10,
  },
  subscriberRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expandButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentDateText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  paymentInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  paymentOwnerText: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: 'bold',
    marginTop: 2,
  },
  historyContainer: {
    backgroundColor: '#f9f9f9',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
    marginLeft: 2,
    marginRight: 2,
  },
  historyItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  historyDotPaid: {
    backgroundColor: '#4CAF50',
  },
  historyDotCancelled: {
    backgroundColor: '#D32F2F',
  },
  historyTextContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyAction: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyActionPaid: {
    color: '#4CAF50',
  },
  historyActionCancelled: {
    color: '#D32F2F',
  },
  historyTimestamp: {
    fontSize: 14,
    color: '#666',
  },
  reportsOverlay: {
    flex: 1,
    backgroundColor: '#E3F2FD',
  },
  reportsContainer: {
    flex: 1,
  },
  reportsContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  reportsSelectors: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  reportsDropdown: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  reportsDropdownText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  searchResults: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 200,
    overflow: 'hidden',
  },
  searchResultItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  searchResultAmper: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: 'bold',
  },
  noResults: {
    textAlign: 'center',
    color: '#999',
    padding: 20,
    fontSize: 16,
  },
  reportCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: 12,
    padding: 16,
  },
  monthlyDataCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: 12,
    padding: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    borderLeftWidth: 4,
  },
  reportCardTitle: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  reportCardValue: {
    fontSize: IS_SMALL ? 16 : 20,
    fontWeight: 'bold',
    marginTop: 2,
  },
  reportSubscriberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reportSubscriberName: {
    fontSize: IS_SMALL ? 17 : 22,
    fontWeight: 'bold',
    color: '#333',
  },
  reportSummary: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  reportSummaryLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  reportSummaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  reportSummaryPaid: {
    color: '#4CAF50',
  },
  reportSummaryRemaining: {
    color: '#D32F2F',
  },
  reportSummaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#ddd',
    marginHorizontal: 8,
  },
  reportTableHeader: {
    flexDirection: 'row-reverse',
    backgroundColor: '#2196F3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  reportTableHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  reportTableRow: {
    flexDirection: 'row-reverse',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    alignItems: 'center',
  },
  reportRowPaid: {
    backgroundColor: '#F1F8E9',
  },
  reportRowUnpaid: {
    backgroundColor: '#FFF3E0',
  },
  reportTableCell: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  reportTableCellSmall: {
    flex: 1.5,
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
  reportStatusBadge: {
    flex: 1,
    alignItems: 'center',
  },
  reportStatusText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: 'white',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  reportStatusPaid: {
    backgroundColor: '#4CAF50',
  },
  reportStatusUnpaid: {
    backgroundColor: '#FF9800',
  },
  reportStatusPartial: {
    backgroundColor: '#FF9800',
  },
  partialModalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: IS_TABLET ? 28 : 20,
    width: IS_TABLET ? MODAL_WIDTH : '90%',
    alignSelf: 'center',
    maxHeight: '80%',
  },
  partialSubscriberInfo: {
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
partialSubscriberName: {
    fontSize: IS_SMALL ? 14 : 17,
    fontWeight: 'bold',
    color: '#333',
},
  partialSubscriberAmper: {
    fontSize: 16,
    color: '#2196F3',
    marginTop: 4,
  },
  partialSummary: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  partialSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  partialSummaryLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  partialSummaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  partialPaid: {
    color: '#4CAF50',
  },
  partialRemaining: {
    color: '#D32F2F',
  },
  partialInputGroup: {
    marginBottom: 20,
  },
  partialInputLabel: {
    fontSize: IS_SMALL ? 14 : 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  partialInput: {
    borderWidth: 2,
    borderColor: '#2196F3',
    borderRadius: 12,
    padding: IS_SMALL ? 12 : 16,
    fontSize: IS_SMALL ? 17 : 20,
    fontWeight: 'bold',
    color: '#333',
  },
  partialConfirmButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  partialConfirmText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  subscriberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partialPayButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FF9800',
  },
  partialPayButtonText: {
    fontSize: 12,
    color: '#FF9800',
    fontWeight: 'bold',
  },
  partialInfoText: {
    fontSize: 13,
    color: '#FF9800',
    fontWeight: '600',
    marginTop: 4,
  },
  partialBadgesRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  partialBadgePaid: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  partialBadgeRemaining: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9800',
  },
  partialBadgeLabel: {
    fontSize: 10,
    color: '#666',
    fontWeight: '500',
  },
  partialBadgeValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
  },
  partialHistorySection: {
    marginBottom: 12,
  },
  paymentHistorySection: {
    marginTop: 4,
  },
  partialHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  partialHistoryTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  historyDotPartial: {
    backgroundColor: '#FF9800',
  },
  historyActionPartial: {
    color: '#FF9800',
  },
  floatingButtons: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    gap: 12,
  },
  refreshButton: {
    backgroundColor: 'white',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  moreButton: {
    backgroundColor: '#333',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },

  mainContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingBottom: IS_SMALL ? 10 : Math.round(15 * SCALE),
    paddingHorizontal: IS_TABLET ? 30 : Math.round(16 * SCALE),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  menuButton: {
    padding: 8,
  },
  logoutButton: {
    padding: 8,
  },
  headerTitle: {
    color: 'white',
    fontSize: IS_SMALL ? 17 : Math.round(22 * SCALE),
    fontWeight: 'bold',
  },
  detailsButton: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailsButtonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: IS_TABLET ? 30 : Math.round(16 * SCALE),
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: IS_SMALL ? 6 : Math.round(10 * SCALE),
    marginTop: IS_SMALL ? 10 : Math.round(16 * SCALE),
  },
  addButton: {
    borderWidth: 1.5,
    borderColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: IS_SMALL ? 14 : Math.round(20 * SCALE),
    paddingVertical: IS_SMALL ? 7 : Math.round(10 * SCALE),
    flexDirection: 'row',
    alignItems: 'center',
    gap: IS_SMALL ? 4 : 6,
  },
  addButtonText: {
    color: '#2196F3',
    fontSize: IS_SMALL ? 13 : Math.round(15 * SCALE),
    fontWeight: '600',
  },
  monthlyDataButton: {
    backgroundColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: IS_SMALL ? 14 : Math.round(20 * SCALE),
    paddingVertical: IS_SMALL ? 7 : Math.round(10 * SCALE),
  },
  monthlyDataButtonText: {
    color: 'white',
    fontSize: IS_SMALL ? 13 : Math.round(15 * SCALE),
    fontWeight: '600',
  },
  dateContainer: {
    backgroundColor: '#E3F2FD',
    borderRadius: IS_SMALL ? 10 : Math.round(12 * SCALE),
    padding: IS_SMALL ? 10 : Math.round(14 * SCALE),
    marginTop: IS_SMALL ? 10 : Math.round(16 * SCALE),
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: IS_SMALL ? 15 : Math.round(18 * SCALE),
    fontWeight: 'bold',
    color: '#333',
  },
  priceSection: {
    marginTop: IS_SMALL ? 10 : Math.round(16 * SCALE),
  },
  priceLabel: {
    fontSize: IS_SMALL ? 13 : Math.round(15 * SCALE),
    fontWeight: '600',
    color: '#333',
    marginBottom: IS_SMALL ? 5 : 8,
    textAlign: 'right',
  },
  priceInput: {
    backgroundColor: 'white',
    borderRadius: IS_SMALL ? 10 : Math.round(12 * SCALE),
    padding: IS_SMALL ? 12 : Math.round(16 * SCALE),
    fontSize: IS_SMALL ? 15 : Math.round(18 * SCALE),
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: IS_SMALL ? 12 : Math.round(20 * SCALE),
  },
  statCard: {
    borderRadius: 16,
    padding: IS_TABLET ? 20 : Math.round(14 * SCALE),
    alignItems: 'center',
    minHeight: IS_TABLET ? 110 : Math.round(80 * SCALE),
    justifyContent: 'center',
    width: IS_TABLET ? '23%' : (IS_SMALL ? '48%' : '31%'),
  },
  totalCard: {
    backgroundColor: '#E3F2FD',
  },
  amperCard: {
    backgroundColor: '#FFF3E0',
  },
  paidCard: {
    backgroundColor: '#E8F5E9',
  },
  unpaidCard: {
    backgroundColor: '#FFEBEE',
  },
  statNumber: {
    fontSize: IS_TABLET ? 34 : Math.round(28 * SCALE),
    fontWeight: 'bold',
  },
  totalNumber: {
    color: '#1976D2',
  },
  amperNumber: {
    color: '#F57C00',
  },
  paidNumber: {
    color: '#388E3C',
  },
  unpaidNumber: {
    color: '#D32F2F',
  },
  statLabel: {
    fontSize: IS_SMALL ? 10 : 13,
    fontWeight: '600',
    marginTop: 4,
  },
  totalLabel: {
    color: '#1976D2',
  },
  amperLabel: {
    color: '#F57C00',
  },
  paidLabel: {
    color: '#388E3C',
  },
  unpaidLabel: {
    color: '#D32F2F',
  },
  requiredCard: {
    backgroundColor: '#E8EAF6',
  },
  requiredNumber: {
    color: '#1565C0',
  },
  requiredLabel: {
    color: '#1565C0',
  },
  amperLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  financialSummary: {
    backgroundColor: 'white',
    borderRadius: IS_SMALL ? 12 : Math.round(16 * SCALE),
    padding: IS_SMALL ? 14 : Math.round(18 * SCALE),
    marginTop: IS_SMALL ? 10 : Math.round(16 * SCALE),
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: IS_SMALL ? 13 : Math.round(16 * SCALE),
    fontWeight: '700',
    color: '#333',
  },
  summaryValue: {
    fontSize: IS_SMALL ? 13 : Math.round(16 * SCALE),
    fontWeight: '700',
    color: '#333',
  },
  collectedValue: {
    color: '#4CAF50',
  },
  expensesSection: {
    backgroundColor: 'white',
    borderRadius: IS_SMALL ? 12 : Math.round(16 * SCALE),
    padding: IS_SMALL ? 10 : Math.round(14 * SCALE),
    marginTop: IS_SMALL ? 8 : Math.round(12 * SCALE),
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  expensesHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginBottom: IS_SMALL ? 6 : 10,
  },
  expensesTitle: {
    fontSize: IS_SMALL ? 13 : Math.round(15 * SCALE),
    fontWeight: '700',
    color: '#333',
  },
  expenseRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: IS_SMALL ? 4 : Math.round(6 * SCALE),
  },
  expenseAddButton: {
    padding: IS_SMALL ? 1 : 2,
  },
  expenseLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: IS_SMALL ? 3 : 5,
    width: IS_SMALL ? 55 : Math.round(80 * SCALE),
  },
  expenseLabel: {
    fontSize: IS_SMALL ? 10 : Math.round(13 * SCALE),
    fontWeight: '600',
    color: '#555',
  },
  expenseInput: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: IS_SMALL ? 6 : 8,
    padding: IS_SMALL ? 5 : Math.round(8 * SCALE),
    fontSize: IS_SMALL ? 12 : Math.round(14 * SCALE),
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginHorizontal: IS_SMALL ? 4 : 6,
    textAlign: 'center',
  },
  netExpectedContainer: {
    backgroundColor: 'white',
    borderRadius: IS_SMALL ? 12 : Math.round(16 * SCALE),
    padding: IS_SMALL ? 14 : Math.round(18 * SCALE),
    marginTop: IS_SMALL ? 10 : Math.round(16 * SCALE),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  netExpectedNegative: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFF5F5',
  },
  netExpectedLabel: {
    fontSize: IS_SMALL ? 13 : Math.round(16 * SCALE),
    fontWeight: '700',
    color: '#333',
  },
  netExpectedValue: {
    fontSize: IS_SMALL ? 13 : Math.round(16 * SCALE),
    fontWeight: '700',
    color: '#333',
  },
  netExpectedValueNegative: {
    color: '#D32F2F',
  },
  bottomButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: IS_SMALL ? 12 : 20,
    marginBottom: IS_SMALL ? 15 : 30,
    gap: IS_SMALL ? 8 : 12,
  },
  showSubscribersButton: {
    backgroundColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: IS_SMALL ? 16 : 24,
    paddingVertical: IS_SMALL ? 10 : 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 2,
    justifyContent: 'center',
  },
  showSubscribersText: {
    color: 'white',
    fontSize: IS_SMALL ? 13 : 16,
    fontWeight: '700',
  },
  reportsButton: {
    borderWidth: 2,
    borderColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: IS_SMALL ? 16 : 24,
    paddingVertical: IS_SMALL ? 10 : 14,
    flex: 1,
    alignItems: 'center',
  },
  reportsButtonText: {
    color: '#2196F3',
    fontSize: IS_SMALL ? 13 : 16,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row-reverse',
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: IS_SMALL ? 9 : 11,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  tabBadge: {
    position: 'absolute',
    top: -2,
    left: '50%',
    marginLeft: 6,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
