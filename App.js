import React, { useState, useEffect, useRef, useMemo } from 'react';
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
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const IS_TABLET = SCREEN_WIDTH >= 768;
const IS_SMALL = SCREEN_WIDTH < 360;
const MODAL_WIDTH = IS_TABLET ? Math.min(500, SCREEN_WIDTH * 0.7) : Math.min(SCREEN_WIDTH * 0.9, 420);
const SCALE = SCREEN_WIDTH / 375;
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';

const API_URL = 'https://server-ten-wheat.vercel.app';

async function apiRequest(method, path, body) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const fetchPromise = fetch(`${API_URL}${path}`, opts);
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ ok: false, json: async () => null }), 15000));
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    if (!res.ok) return null;
    try { return await res.json(); } catch (e2) { return null; }
  } catch (e) {
    return null;
  }
}

async function saveToFile(filename, data) {
  const result = await apiRequest('POST', '/api', { _table: 'app_data', filename, data_value: data });
  if (result !== null) {
    await saveLocalCache('app_' + filename, data);
  }
  return result;
}

async function loadFromFile(filename) {
  const result = await apiRequest('GET', `/api?table=app_data&filename=${encodeURIComponent(filename)}`);
  if (Array.isArray(result) && result.length > 0) {
    let val = result[0].data_value;
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
    await saveLocalCache('app_' + filename, val);
    return val;
  }
  return await loadLocalCache('app_' + filename);
}

async function deleteFile(filename) {
  await apiRequest('DELETE', `/api?table=app_data&filename=${encodeURIComponent(filename)}`);
}

async function saveUserData(phone, key, data) {
  const result = await apiRequest('POST', '/api', { _table: 'user_data', phone, data_key: key, data_value: data });
  if (result !== null) {
    await saveLocalCache('user_' + phone + '_' + key, data);
  }
  return result;
}

async function loadUserData(phone, key) {
  const result = await apiRequest('GET', `/api?table=user_data&phone=${encodeURIComponent(phone)}&key=${encodeURIComponent(key)}`);
  if (Array.isArray(result) && result.length > 0) {
    let val = result[0].data_value;
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
    await saveLocalCache('user_' + phone + '_' + key, val);
    return val;
  }
  return await loadLocalCache('user_' + phone + '_' + key);
}

async function loadAllUserKeys(phone) {
  const result = await apiRequest('GET', `/api?table=user_data&phone=${encodeURIComponent(phone)}`);
  const map = {};
  if (Array.isArray(result)) {
    for (const row of result) {
      let val = row.data_value;
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
      map[row.data_key] = val;
    }
  }
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
    } catch (e) {
      console.warn('PBKDF2 verify error:', e);
    }
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

async function exportUserData(phone) {
  const allData = await loadAllUserKeys(phone);
  if (!allData || Object.keys(allData).length === 0) {
    return null;
  }
  const exportObj = {
    appVersion: '1.0.0',
    exportDate: new Date().toISOString(),
    phone: phone,
    keys: allData,
  };
  const json = JSON.stringify(exportObj, null, 2);
  const fileName = `backup_${phone}_${Date.now()}.json`;
  const filePath = FileSystem.documentDirectory + fileName;
  await FileSystem.writeAsStringAsync(filePath, json);
  return filePath;
}

async function importUserData(filePath) {
  try {
    const content = await FileSystem.readAsStringAsync(filePath);
    const importObj = JSON.parse(content);
    if (!importObj.phone) {
      return { success: false, error: 'ملف غير صالح' };
    }
    const data = importObj.keys || importObj.data;
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'ملف غير صالح' };
    }
    for (const [key, value] of Object.entries(data)) {
      await saveUserData(importObj.phone, key, value);
    }
    return { success: true, phone: importObj.phone };
  } catch (e) {
    return { success: false, error: 'خطأ في قراءة الملف' };
  }
}

const OnboardingScreen = ({ onComplete }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = [
    {
      icon: 'flash',
      iconColor: '#FFD700',
      title: 'نظام جباية المولدات',
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
      icon: 'cloud-upload',
      iconColor: '#9C27B0',
      title: 'نسخ احتياطي',
      description: 'حفظ البيانات تلقائياً في السحابة مع إمكانية التصدير والاستيراد',
      bg: '#6A1B9A',
    },
    {
      icon: 'person-add',
      iconColor: '#F44336',
      title: 'إدارة العمال',
      description: 'إضافة عامل جديد من الإعدادات عن طريق كود ورمز سري. يمكن تخصيص صلاحياته: إضافة مشتركين، تعديل بيانات، حذف مشتركين، تغيير الأمبير، دفع الأقساط، وإلغاء الدفعات',
      bg: '#4A148C',
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
      <View style={{ flex: 1, justifyContent: 'space-between', padding: 30, paddingTop: 60 }}>
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 80, width: 160, height: 160, justifyContent: 'center', alignItems: 'center', marginBottom: 40 }}>
            <Ionicons name={slides[currentSlide].icon} size={80} color={slides[currentSlide].iconColor} />
          </View>
          <Text style={{ color: 'white', fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 }}>{slides[currentSlide].title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, textAlign: 'center', lineHeight: 28 }}>{slides[currentSlide].description}</Text>
        </View>

        <View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'center', marginBottom: 40 }}>
            {slides.map((_, index) => (
              <View
                key={index}
                style={{
                  width: currentSlide === index ? 28 : 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: currentSlide === index ? 'white' : 'rgba(255,255,255,0.4)',
                  marginHorizontal: 4,
                }}
              />
            ))}
          </View>

          <TouchableOpacity
            style={{ backgroundColor: 'white', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 16 }}
            onPress={handleNext}
          >
            <Text style={{ color: slides[currentSlide].bg, fontSize: 18, fontWeight: 'bold' }}>
              {currentSlide === slides.length - 1 ? 'ابدأ الآن' : 'التالي'}
            </Text>
          </TouchableOpacity>

          {currentSlide < slides.length - 1 && (
            <TouchableOpacity onPress={handleSkip} style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>تخطي</Text>
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
          <Ionicons name="flash" size={80} color="#FFD700" />
          <Text style={styles.welcomeTitle}>نظام الجباية</Text>
          <Text style={styles.welcomeSubtitle}>نظام جباية المولدات الأهلية</Text>
        </View>

        <TouchableOpacity style={styles.welcomeLoginBtn} onPress={onLogin}>
          <Text style={styles.welcomeLoginText}>تسجيل الدخول</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.welcomeRegisterBtn} onPress={onRegister}>
          <Text style={styles.welcomeRegisterText}>إنشاء حساب جديد</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.welcomeRegisterBtn, { backgroundColor: '#FF9800', marginTop: 15 }]} onPress={onWorkerLogin}>
          <Ionicons name="person-outline" size={20} color="white" style={{ marginLeft: 8 }} />
          <Text style={styles.welcomeRegisterText}>دخول العامل</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const RegisterScreen = ({ onBack, onRegister, onRegisterSuccess }) => {
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [confirmOwnerCode, setConfirmOwnerCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
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
        { text: 'موافق', onPress: function() { if (onRegisterSuccess) onRegisterSuccess(phone.trim()); else onBack(); } }
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
              maxLength={50}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="الرمز (6 أحرف أو أرقام على الأقل)"
              placeholderTextColor="#999"
              value={ownerCode}
              onChangeText={setOwnerCode}
              maxLength={20}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="تأكيد الرمز"
              placeholderTextColor="#999"
              value={confirmOwnerCode}
              onChangeText={setConfirmOwnerCode}
              maxLength={20}
            />
          </View>

          <TouchableOpacity style={styles.loginButton} onPress={handleRegister}>
            <Text style={styles.loginButtonText}>إنشاء الحساب</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onBack}>
            <Text style={styles.linkText}>لديك حساب بالفعل؟ تسجيل الدخول</Text>
          </TouchableOpacity>
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
        if (newAttempts >= 5) {
          setLockUntil(Date.now() + 15 * 60 * 1000);
          setLoginAttempts(0);
          Alert.alert('تنبيه', 'تم حظر الحساب لمدة 15 دقيقة بسبب محاولات كثيرة');
        } else {
          Alert.alert('تنبيه', `رقم الهاتف أو كلمة المرور غير صحيحة (${newAttempts}/5)`);
        }
        return;
      }

      setLoginAttempts(0);
      setLockUntil(null);
      await saveToFile('current_user', { phone: phone.trim(), role: 'owner' });
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

          <TouchableOpacity onPress={onWorkerLogin} style={{ marginTop: 15 }}>
            <Text style={[styles.linkText, { color: '#FF9800' }]}>دخول العامل</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const WorkerLoginScreen = ({ onBack, onLogin, savedWorkerName }) => {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [workerName, setWorkerName] = useState(savedWorkerName || '');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!workerName.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال اسمك');
      return;
    }
    if (!code.trim() || !pin.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال الكود والرمز السري');
      return;
    }
    setLoading(true);
    try {
      const result = await onLogin(code.trim(), pin.trim(), workerName.trim());
      if (result.deleted) {
        Alert.alert('تنبيه', 'تم حذف الحساب من قبل صاحب المولد');
      } else if (result.nameMismatch) {
        Alert.alert('تنبيه', 'الاسم غير مطابق. اسمك المسجل هو: ' + result.savedName + '\nيرجى تسجيل الدخول بالاسم الصحيح');
        setWorkerName(result.savedName);
      } else if (!result.success) {
        Alert.alert('تنبيه', 'الكود أو الرمز السري غير صحيح');
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
      <LoadingOverlay visible={loading} text="جاري التحقق..." />
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
            <Ionicons name="person-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={[styles.input, savedWorkerName ? { backgroundColor: '#f0f0f0', color: '#333' } : {}]}
              placeholder="اسمك (مطلوب)"
              placeholderTextColor="#999"
              value={workerName}
              onChangeText={savedWorkerName ? null : setWorkerName}
              textAlign="right"
              editable={!savedWorkerName}
            />
          </View>

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
        </View>
      </View>
    </View>
  );
};

const SettingsScreen = ({ visible, onClose, generatorName, onSaveGeneratorName, ownerName, onSaveOwnerName, onExport, onImport, onCreateWorker, pendingWorkerUpdates, onLoadUpdates, workers, onUpdateWorker, onDeleteWorker, onShowUpdates, onLogout, darkMode, onToggleDarkMode, newWorkerCredentials, onDismissCredentials, generators, onDeleteGenerator, onRestoreGenerator, deletedGenerators, currentGeneratorId, onChangePassword }) => {
  const [name, setName] = useState(generatorName);
  const [owner, setOwner] = useState(ownerName);
  const [workerModalVisible, setWorkerModalVisible] = useState(false);
  const [workerPermissions, setWorkerPermissions] = useState([]);
  const [workerAssignedGenerators, setWorkerAssignedGenerators] = useState([]);
  const [editWorkerVisible, setEditWorkerVisible] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [editWorkerPermissions, setEditWorkerPermissions] = useState([]);
  const [editWorkerAssignedGenerators, setEditWorkerAssignedGenerators] = useState([]);
  const [deleteGenPassword, setDeleteGenPassword] = useState('');
  const [selectedDeleteGenId, setSelectedDeleteGenId] = useState(null);
  const [deleteGeneratorVisible, setDeleteGeneratorVisible] = useState(false);
  const [restoreGeneratorVisible, setRestoreGeneratorVisible] = useState(false);
  const [changePassVisible, setChangePassVisible] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');

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

  const togglePermission = (perm) => {
    setWorkerPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const handleConfirmCreateWorker = () => {
    if (workerPermissions.length === 0) {
      Alert.alert('تنبيه', 'اختر صلاحية واحدة على الأقل');
      return;
    }
    onCreateWorker(workerPermissions, workerAssignedGenerators);
    setWorkerPermissions([]);
    setWorkerAssignedGenerators([]);
    setWorkerModalVisible(false);
  };

  return (<>
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={{ flex: 1, backgroundColor: darkMode ? '#121212' : 'white' }}>
          <View style={[styles.modalHeader, { backgroundColor: '#1565C0' }]}>
            <TouchableOpacity onPress={() => { onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }} style={[styles.backButton, { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="arrow-forward" size={28} color="white" />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: 'white' }]}>الإعدادات</Text>
            <TouchableOpacity onPress={() => { onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }}>
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

              <View style={[styles.settingsDivider, darkMode && { backgroundColor: '#333' }]} />

              <Text style={[styles.settingsLabel, darkMode && { color: '#fff' }]}>إدارة العمال</Text>
              <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#FF9800', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]} onPress={() => setWorkerModalVisible(true)}>
                <Ionicons name="person-add-outline" size={20} color="white" />
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>إضافة عامل</Text>
              </TouchableOpacity>
              <Text style={[styles.settingsHint, darkMode && { color: '#888' }]}>إنشاء كود ورمز سري جديد للعامل</Text>

              <View style={{ marginTop: 10 }}>
                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#2196F3', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]} onPress={() => setEditWorkerVisible(true)}>
                  <Ionicons name="create-outline" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>تعديل بيانات العامل</Text>
                </TouchableOpacity>
                <Text style={styles.settingsHint}>تعديل الصلاحيات أو حذف عامل</Text>
              </View>

              {pendingWorkerUpdates.length > 0 && (
                <View style={{ marginTop: 15 }}>
                  <TouchableOpacity
                    style={[styles.settingsInput, { backgroundColor: '#F44336', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}
                    onPress={() => { onClose(); onShowUpdates(); }}
                  >
                    <Ionicons name="notifications-outline" size={20} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>رؤية التحديثات الجديدة</Text>
                    <View style={{ backgroundColor: 'white', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 }}>
                      <Text style={{ color: '#F44336', fontWeight: 'bold', fontSize: 13 }}>{pendingWorkerUpdates.length}</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.settingsHint}>يوجد تحديثات من العامل قيد الانتظار</Text>
                </View>
              )}

              <View style={[styles.settingsDivider, darkMode && { backgroundColor: '#333' }]} />

              <Text style={[styles.settingsLabel, darkMode && { color: '#fff' }]}>النسخ الاحتياطي</Text>
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#2196F3', borderWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]} onPress={onExport}>
                  <Ionicons name="cloud-upload-outline" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>تصدير</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#4CAF50', borderWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]} onPress={onImport}>
                  <Ionicons name="cloud-download-outline" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>استيراد</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.settingsHint, darkMode && { color: '#888' }]}>تصدير: حفظ نسخة احتياطية ومشاركتها عبر واتساب أو إيميل</Text>
              <Text style={[styles.settingsHint, darkMode && { color: '#888' }]}>استيراد: استعادة بيانات من نسخة احتياطية سابقة</Text>

              <View style={{ marginTop: 20, marginBottom: 10 }}>
                <View style={{ height: 1, backgroundColor: '#ddd', marginBottom: 16 }} />

                <TouchableOpacity
                  style={[styles.settingsInput, { backgroundColor: '#9C27B0', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12 }]}
                  onPress={() => setChangePassVisible(true)}
                >
                  <Ionicons name="key-outline" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>تغيير رمز الحساب</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: 10, marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
                    <Ionicons name={darkMode ? 'moon' : 'sunny'} size={22} color={darkMode ? '#FFD700' : '#FF9800'} />
                    <Text style={{ fontSize: 15, fontWeight: '600', color: darkMode ? '#fff' : '#333' }}>الوضع الليلي</Text>
                  </View>
                  <TouchableOpacity
                    style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: darkMode ? '#4CAF50' : '#ccc', justifyContent: 'center', paddingHorizontal: 3 }}
                    onPress={onToggleDarkMode}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'white', alignSelf: darkMode ? 'flex-end' : 'flex-start' }} />
                  </TouchableOpacity>
                </View>
                {generators && generators.length > 1 && (
                  <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#F44336', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10 }]} onPress={() => setDeleteGeneratorVisible(true)}>
                    <Ionicons name="trash-outline" size={20} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>حذف مولد</Text>
                  </TouchableOpacity>
                )}
                {deletedGenerators && deletedGenerators.length > 0 && (
                  <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#4CAF50', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10 }]} onPress={() => setRestoreGeneratorVisible(true)}>
                    <Ionicons name="refresh-outline" size={20} color="white" />
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>استرداد بيانات المولد ({deletedGenerators.length})</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#F44336', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]} onPress={onLogout}>
                  <Ionicons name="log-out-outline" size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>تسجيل الخروج</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
      </View>

      <Modal visible={workerModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setWorkerModalVisible(false); setWorkerPermissions([]); }}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>صلاحيات العامل</Text>
            </View>

            <Text style={{ color: '#666', marginBottom: 20, textAlign: 'center' }}>اختر الصلاحيات التي تريدها للعامل:</Text>

            <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => togglePermission('add')}>
              <Ionicons name={workerPermissions.includes('add') ? 'checkbox' : 'square-outline'} size={26} color={workerPermissions.includes('add') ? '#4CAF50' : '#999'} />
              <Text style={{ fontSize: 16, color: '#333' }}>إضافة مشتركين</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => togglePermission('edit')}>
              <Ionicons name={workerPermissions.includes('edit') ? 'checkbox' : 'square-outline'} size={26} color={workerPermissions.includes('edit') ? '#4CAF50' : '#999'} />
              <Text style={{ fontSize: 16, color: '#333' }}>تعديل بيانات المشتركين</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => togglePermission('delete')}>
              <Ionicons name={workerPermissions.includes('delete') ? 'checkbox' : 'square-outline'} size={26} color={workerPermissions.includes('delete') ? '#4CAF50' : '#999'} />
              <Text style={{ fontSize: 16, color: '#333' }}>حذف مشتركين</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => togglePermission('amperPrice')}>
              <Ionicons name={workerPermissions.includes('amperPrice') ? 'checkbox' : 'square-outline'} size={26} color={workerPermissions.includes('amperPrice') ? '#4CAF50' : '#999'} />
              <Text style={{ fontSize: 16, color: '#333' }}>تغيير سعر الأميبر</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => togglePermission('cancelPayment')}>
              <Ionicons name={workerPermissions.includes('cancelPayment') ? 'checkbox' : 'square-outline'} size={26} color={workerPermissions.includes('cancelPayment') ? '#4CAF50' : '#999'} />
              <Text style={{ fontSize: 16, color: '#333' }}>إلغاء الدفع</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => togglePermission('partialPayment')}>
              <Ionicons name={workerPermissions.includes('partialPayment') ? 'checkbox' : 'square-outline'} size={26} color={workerPermissions.includes('partialPayment') ? '#4CAF50' : '#999'} />
              <Text style={{ fontSize: 16, color: '#333' }}>الدفع الجزئي</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 16, marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10, textAlign: 'right' }}>المولدات المسموح بها:</Text>
              {generators && generators.length > 1 ? generators.map(function(gen) {
                const isSelected = workerAssignedGenerators.indexOf(gen.id) >= 0;
                return (
                  <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={function() {
                    setWorkerAssignedGenerators(function(prev) {
                      if (isSelected) return prev.filter(function(id) { return id !== gen.id; });
                      return [...prev, gen.id];
                    });
                  }}>
                    <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={26} color={isSelected ? '#FF9800' : '#999'} />
                    <Text style={{ fontSize: 16, color: '#333' }}>{gen.name}</Text>
                    <Text style={{ fontSize: 13, color: '#999' }}>({(gen.subscribers || []).length} مشترك)</Text>
                  </TouchableOpacity>
                );
              }) : <Text style={{ fontSize: 14, color: '#999', textAlign: 'center' }}>مولد واحد فقط - العامل يعمل عليه</Text>}
            </View>

            <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#FF9800', marginTop: 20 }]} onPress={handleConfirmCreateWorker}>
              <Text style={styles.modalButtonText}>إنشاء حساب العامل</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={editWorkerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedWorker ? (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => { setSelectedWorker(null); setEditWorkerPermissions([]); setEditWorkerAssignedGenerators([]); }}>
                    <Ionicons name="arrow-forward" size={28} color="#333" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>تعديل صلاحيات العامل</Text>
                  <View style={{ width: 30 }} />
                </View>
                <Text style={{ color: '#666', marginBottom: 10, textAlign: 'center' }}>كود: {selectedWorker.code}</Text>
                <Text style={{ color: '#666', marginBottom: 20, textAlign: 'center' }}>اختر الصلاحيات الجديدة:</Text>

                <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => setEditWorkerPermissions(prev => prev.includes('add') ? prev.filter(p => p !== 'add') : [...prev, 'add'])}>
                  <Ionicons name={editWorkerPermissions.includes('add') ? 'checkbox' : 'square-outline'} size={26} color={editWorkerPermissions.includes('add') ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: 16, color: '#333' }}>إضافة مشتركين</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => setEditWorkerPermissions(prev => prev.includes('edit') ? prev.filter(p => p !== 'edit') : [...prev, 'edit'])}>
                  <Ionicons name={editWorkerPermissions.includes('edit') ? 'checkbox' : 'square-outline'} size={26} color={editWorkerPermissions.includes('edit') ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: 16, color: '#333' }}>تعديل بيانات المشتركين</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => setEditWorkerPermissions(prev => prev.includes('delete') ? prev.filter(p => p !== 'delete') : [...prev, 'delete'])}>
                  <Ionicons name={editWorkerPermissions.includes('delete') ? 'checkbox' : 'square-outline'} size={26} color={editWorkerPermissions.includes('delete') ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: 16, color: '#333' }}>حذف مشتركين</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => setEditWorkerPermissions(prev => prev.includes('amperPrice') ? prev.filter(p => p !== 'amperPrice') : [...prev, 'amperPrice'])}>
                  <Ionicons name={editWorkerPermissions.includes('amperPrice') ? 'checkbox' : 'square-outline'} size={26} color={editWorkerPermissions.includes('amperPrice') ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: 16, color: '#333' }}>تغيير سعر الأميبر</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => setEditWorkerPermissions(prev => prev.includes('cancelPayment') ? prev.filter(p => p !== 'cancelPayment') : [...prev, 'cancelPayment'])}>
                  <Ionicons name={editWorkerPermissions.includes('cancelPayment') ? 'checkbox' : 'square-outline'} size={26} color={editWorkerPermissions.includes('cancelPayment') ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: 16, color: '#333' }}>إلغاء الدفع</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => setEditWorkerPermissions(prev => prev.includes('partialPayment') ? prev.filter(p => p !== 'partialPayment') : [...prev, 'partialPayment'])}>
                  <Ionicons name={editWorkerPermissions.includes('partialPayment') ? 'checkbox' : 'square-outline'} size={26} color={editWorkerPermissions.includes('partialPayment') ? '#4CAF50' : '#999'} />
                  <Text style={{ fontSize: 16, color: '#333' }}>الدفع الجزئي</Text>
                </TouchableOpacity>

                <View style={{ marginTop: 16, marginBottom: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10, textAlign: 'right' }}>المولدات المسموح بها:</Text>
                  {generators && generators.length > 1 ? generators.map(function(gen) {
                    const isSelected = editWorkerAssignedGenerators.indexOf(gen.id) >= 0;
                    return (
                      <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={function() {
                        setEditWorkerAssignedGenerators(function(prev) {
                          if (isSelected) return prev.filter(function(id) { return id !== gen.id; });
                          return [...prev, gen.id];
                        });
                      }}>
                        <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={26} color={isSelected ? '#FF9800' : '#999'} />
                        <Text style={{ fontSize: 16, color: '#333' }}>{gen.name}</Text>
                        <Text style={{ fontSize: 13, color: '#999' }}>({(gen.subscribers || []).length} مشترك)</Text>
                      </TouchableOpacity>
                    );
                  }) : <Text style={{ fontSize: 14, color: '#999', textAlign: 'center' }}>مولد واحد فقط</Text>}
                </View>

                <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#4CAF50', marginTop: 20 }]} onPress={() => {
                  if (editWorkerPermissions.length === 0) {
                    Alert.alert('تنبيه', 'اختر صلاحية واحدة على الأقل');
                    return;
                  }
                  onUpdateWorker(selectedWorker.code, editWorkerPermissions, editWorkerAssignedGenerators);
                  setSelectedWorker(null);
                  setEditWorkerPermissions([]);
                  setEditWorkerAssignedGenerators([]);
                }}>
                  <Text style={styles.modalButtonText}>حفظ التعديلات</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#D32F2F', marginTop: 10 }]} onPress={() => {
                  Alert.alert('حذف العامل', `هل تريد حذف العامل "${selectedWorker.code}" نهائياً؟\nسيتم تسجيل خروج العامل تلقائياً وتعطيل الكود.`, [
                    { text: 'إلغاء', style: 'cancel' },
                    { text: 'نعم، حذف', style: 'destructive', onPress: () => { onDeleteWorker(selectedWorker.code); setSelectedWorker(null); setEditWorkerPermissions([]); setEditWorkerAssignedGenerators([]); setEditWorkerVisible(false); } },
                  ]);
                }}>
                  <Ionicons name="trash-outline" size={20} color="white" />
                  <Text style={styles.modalButtonText}>حذف العامل نهائياً</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => setEditWorkerVisible(false)}>
                    <Ionicons name="close" size={28} color="#333" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>تعديل بيانات العامل</Text>
                  <View style={{ width: 30 }} />
                </View>
                {(!workers || workers.length === 0) ? (
                  <View style={{ padding: 40, alignItems: 'center' }}>
                    <Ionicons name="people-outline" size={60} color="#ccc" />
                    <Text style={{ color: '#999', fontSize: 16, marginTop: 10 }}>لا يوجد عمال مسجلين</Text>
                  </View>
                ) : (
                  workers.map((worker, index) => (
                    <View key={index} style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                      <TouchableOpacity style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 12 }} onPress={() => {
                        setSelectedWorker(worker);
                        setEditWorkerPermissions(worker.permissions || []);
                        setEditWorkerAssignedGenerators(worker.assignedGenerators || []);
                      }}>
                        <View style={{ backgroundColor: '#FF9800', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="person" size={20} color="white" />
                        </View>
                        <View>
                          <Text style={{ fontSize: 16, color: '#333', fontWeight: 'bold' }}>كود: {worker.code}</Text>
                          <Text style={{ fontSize: 13, color: '#999', marginTop: 2 }}>الرمز: {worker.pin}</Text>
                          <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{(worker.permissions || []).length} صلاحيات</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={async () => {
                        await Clipboard.setStringAsync(`كود العامل: ${worker.code}\nالرمز السري: ${worker.pin}`);
                        Alert.alert('تم النسخ', `كود: ${worker.code}\nرمز: ${worker.pin}`);
                      }} style={{ backgroundColor: '#E3F2FD', borderRadius: 8, padding: 8 }}>
                        <Ionicons name="copy-outline" size={18} color="#2196F3" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => {
                        Alert.alert('حذف العامل', 'هل تريد حذف العامل "' + worker.code + '"؟', [
                          { text: 'إلغاء', style: 'cancel' },
                          { text: 'حذف', style: 'destructive', onPress: () => onDeleteWorker(worker.code) },
                        ]);
                      }} style={{ backgroundColor: '#FFEBEE', borderRadius: 8, padding: 8 }}>
                        <Ionicons name="trash-outline" size={18} color="#F44336" />
                      </TouchableOpacity>
                      <Ionicons name="chevron-back" size={24} color="#999" style={{ marginLeft: 8 }} />
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </Modal>

    <Modal visible={!!newWorkerCredentials} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: 16, padding: 24, width: MODAL_WIDTH, alignItems: 'center' }}>
          <View style={{ backgroundColor: '#4CAF50', borderRadius: 40, width: 70, height: 70, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Ionicons name="checkmark-circle" size={40} color="white" />
          </View>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: darkMode ? '#fff' : '#333', marginBottom: 8 }}>تم إنشاء حساب العامل</Text>

          <View style={{ width: '100%', backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 13, color: darkMode ? '#aaa' : '#666', marginBottom: 6, textAlign: 'center' }}>كود العامل</Text>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#1565C0', letterSpacing: 2 }}>{newWorkerCredentials ? newWorkerCredentials.code : ''}</Text>
              <TouchableOpacity onPress={async () => { await Clipboard.setStringAsync(newWorkerCredentials ? newWorkerCredentials.code : ''); Alert.alert('تم النسخ', 'تم نسخ كود العامل'); }} style={{ backgroundColor: '#E3F2FD', borderRadius: 8, padding: 8 }}>
                <Ionicons name="copy-outline" size={20} color="#1565C0" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ width: '100%', backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 13, color: darkMode ? '#aaa' : '#666', marginBottom: 6, textAlign: 'center' }}>الرمز السري</Text>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#F44336', letterSpacing: 2 }}>{newWorkerCredentials ? newWorkerCredentials.pin : ''}</Text>
              <TouchableOpacity onPress={async () => { await Clipboard.setStringAsync(newWorkerCredentials ? newWorkerCredentials.pin : ''); Alert.alert('تم النسخ', 'تم نسخ الرمز السري'); }} style={{ backgroundColor: '#FFEBEE', borderRadius: 8, padding: 8 }}>
                <Ionicons name="copy-outline" size={20} color="#F44336" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ width: '100%', backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5', borderRadius: 12, padding: 12, marginBottom: 20 }}>
            <Text style={{ fontSize: 13, color: darkMode ? '#aaa' : '#666', textAlign: 'center' }}>الصلاحيات: {newWorkerCredentials && newWorkerCredentials.permissions ? newWorkerCredentials.permissions.map(function(p) { return PERMISSION_LABELS[p] || p; }).join('، ') : ''}</Text>
          </View>

          <TouchableOpacity style={{ backgroundColor: '#FF9800', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, width: '100%', alignItems: 'center', marginBottom: 10 }} onPress={async () => {
            const text = `كود العامل: ${newWorkerCredentials ? newWorkerCredentials.code : ''}\nالرمز السري: ${newWorkerCredentials ? newWorkerCredentials.pin : ''}`;
            await Clipboard.setStringAsync(text);
            Alert.alert('تم النسخ', 'تم نسخ كود العامل والرمز السري');
          }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <Ionicons name="copy" size={20} color="white" />
              <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>نسخ الكود والرمز</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={{ backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, width: '100%', alignItems: 'center' }} onPress={onDismissCredentials}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>حسناً</Text>
          </TouchableOpacity>
        </View>
      </View>
      </Modal>

      <Modal visible={deleteGeneratorVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: 16, padding: 24, width: MODAL_WIDTH, maxHeight: '70%' }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#F44336' }}>حذف مولد</Text>
              <TouchableOpacity onPress={() => { setDeleteGeneratorVisible(false); setDeleteGenPassword(''); setSelectedDeleteGenId(null); }}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: 12 }}>اختر المولد المراد حذفه:</Text>
            {generators.map(function(gen) {
              return (
                <TouchableOpacity key={gen.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: selectedDeleteGenId === gen.id ? (darkMode ? '#3a1a1a' : '#FFEBEE') : 'transparent', borderRadius: selectedDeleteGenId === gen.id ? 8 : 0 }} onPress={function() { setSelectedDeleteGenId(gen.id); }}>
                  <Ionicons name={selectedDeleteGenId === gen.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={selectedDeleteGenId === gen.id ? '#F44336' : '#999'} style={{ marginLeft: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, color: darkMode ? '#fff' : '#333' }}>{gen.name}</Text>
                    <Text style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{(gen.subscribers || []).length} مشترك</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: 8 }}>أدخل كلمة المرور للتأكيد:</Text>
              <TextInput style={[styles.settingsInput, { textAlign: 'center', textAlignVertical: 'center' }]} placeholder="كلمة المرور" placeholderTextColor="#999" value={deleteGenPassword} onChangeText={setDeleteGenPassword} secureTextEntry />
            </View>
            <TouchableOpacity style={{ backgroundColor: '#F44336', borderRadius: 12, paddingVertical: 14, width: '100%', alignItems: 'center', marginTop: 16, opacity: selectedDeleteGenId && deleteGenPassword ? 1 : 0.5 }} disabled={!selectedDeleteGenId || !deleteGenPassword} onPress={async function() {
              if (!selectedDeleteGenId || !deleteGenPassword) return;
              const success = await onDeleteGenerator(selectedDeleteGenId, deleteGenPassword);
              if (success === false) {
                Alert.alert('خطأ', 'كلمة المرور غير صحيحة');
              } else {
                setDeleteGeneratorVisible(false);
                setDeleteGenPassword('');
                setSelectedDeleteGenId(null);
                Alert.alert('تم', 'تم حذف المولد بنجاح. يمكنك استرداده من قائمة الاسترداد.');
              }
            }}>
              <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>حذف المولد</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={restoreGeneratorVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: 16, padding: 24, width: MODAL_WIDTH, maxHeight: '70%' }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#4CAF50' }}>استرداد بيانات المولد</Text>
              <TouchableOpacity onPress={() => setRestoreGeneratorVisible(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: 4 }}>المولدات المحذوفة (تُحذف نهائياً بعد شهر):</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {deletedGenerators.map(function(dg) {
                const daysLeft = Math.max(0, Math.ceil((30 * 24 * 60 * 60 * 1000 - (Date.now() - dg.deletedAt)) / (24 * 60 * 60 * 1000)));
                const dgData = dg.data || {};
                const subCount = (dgData.subscribers || []).length;
                return (
                  <TouchableOpacity key={dg.id} style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={function() {
                    Alert.alert('استرداد المولد', 'هل تريد استرداد "' + dg.name + '"؟', [
                      { text: 'إلغاء', style: 'cancel' },
                      { text: 'نعم، استرداد', onPress: function() { onRestoreGenerator(dg.id); } },
                    ]);
                  }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, color: darkMode ? '#fff' : '#333', fontWeight: 'bold' }}>{dg.name}</Text>
                      <Text style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{subCount} مشترك - يتبقى {daysLeft} يوم</Text>
                    </View>
                    <Ionicons name="refresh-outline" size={22} color="#4CAF50" />
                  </TouchableOpacity>
                );
              })}
              {deletedGenerators.length === 0 && (
                <Text style={{ fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 20 }}>لا توجد مولدات محذوفة</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={changePassVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={{ backgroundColor: darkMode ? '#1e1e1e' : 'white', borderRadius: 16, padding: 24, width: MODAL_WIDTH }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#9C27B0' }}>تغيير رمز الحساب</Text>
              <TouchableOpacity onPress={() => { setChangePassVisible(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); }}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14, color: darkMode ? '#aaa' : '#666', textAlign: 'center', marginBottom: 16 }}>أدخل الرمز الحالي ثم الرمز الجديد</Text>

            <Text style={{ fontSize: 13, color: darkMode ? '#aaa' : '#555', marginBottom: 6, textAlign: 'right' }}>الرمز الحالي</Text>
            <TextInput style={[styles.settingsInput, { textAlign: 'center' }]} placeholder="الرمز الحالي" placeholderTextColor="#999" value={currentPass} onChangeText={setCurrentPass} secureTextEntry maxLength={50} />

            <Text style={{ fontSize: 13, color: darkMode ? '#aaa' : '#555', marginBottom: 6, marginTop: 12, textAlign: 'right' }}>الرمز الجديد</Text>
            <TextInput style={[styles.settingsInput, { textAlign: 'center' }]} placeholder="الرمز الجديد (6 أحرف على الأقل)" placeholderTextColor="#999" value={newPass} onChangeText={setNewPass} secureTextEntry maxLength={50} />

            <Text style={{ fontSize: 13, color: darkMode ? '#aaa' : '#555', marginBottom: 6, marginTop: 12, textAlign: 'right' }}>تأكيد الرمز الجديد</Text>
            <TextInput style={[styles.settingsInput, { textAlign: 'center' }]} placeholder="أعد إدخال الرمز الجديد" placeholderTextColor="#999" value={confirmPass} onChangeText={setConfirmPass} secureTextEntry maxLength={50} />

            <TouchableOpacity
              style={{ backgroundColor: '#9C27B0', borderRadius: 12, paddingVertical: 14, width: '100%', alignItems: 'center', marginTop: 16, opacity: currentPass && newPass && confirmPass ? 1 : 0.5 }}
              disabled={!currentPass || !newPass || !confirmPass}
              onPress={async () => {
                if (!currentPass.trim()) { Alert.alert('تنبيه', 'أدخل الرمز الحالي'); return; }
                if (newPass.trim().length < 6) { Alert.alert('تنبيه', 'الرمز الجديد يجب أن يكون 6 أحرف على الأقل'); return; }
                if (newPass.trim() !== confirmPass.trim()) { Alert.alert('تنبيه', 'الرمز الجديد غير متطابق'); return; }
                if (currentPass.trim() === newPass.trim()) { Alert.alert('تنبيه', 'الرمز الجديد نفس الرمز الحالي'); return; }
                const success = await onChangePassword(currentPass.trim(), newPass.trim());
                if (success) {
                  setChangePassVisible(false);
                  setCurrentPass('');
                  setNewPass('');
                  setConfirmPass('');
                  Alert.alert('تم', 'تم تغيير رمز الحساب بنجاح');
                } else {
                  Alert.alert('خطأ', 'الرمز الحالي غير صحيح');
                }
              }}
            >
              <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>تغيير الرمز</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
  </>);
};

const WorkerUpdatesModal = ({ visible, onClose, batches, onApplyBatch, onDeleteBatch, amperPrices, rejectedBatches, onReapplyBatch }) => {
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
                    <Text style={{ fontSize: 15, color: '#F44336', fontWeight: 'bold', marginRight: 6 }}>التحديثات المحذوفة ({safeRejected.length})</Text>
                  </TouchableOpacity>
                  {showRejected && safeRejected.map(function(batch) {
                    let updates = Array.isArray(batch.updates) ? batch.updates : [];
                    return (
                      <View key={batch.id || 'r'} style={{ backgroundColor: '#FFF3E0', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#FFCC80' }}>
                        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center' }}>
                            <View style={{ backgroundColor: '#F44336', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>محذوف</Text>
                            </View>
                            <Text style={{ fontSize: 13, color: '#666' }}>{batch.workerName || ''}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: '#999' }}>{batch.timestamp || ''}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>عدد التحديثات: {updates.length}</Text>
                        <TouchableOpacity style={{ backgroundColor: '#4CAF50', borderRadius: 8, padding: 8, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 }} onPress={() => {
                          Alert.alert('إعادة التحديث', 'هل تريد إعادة هذه الدفعة إلى قائمة التحديثات المعلقة؟', [
                            { text: 'إلغاء', style: 'cancel' },
                            { text: 'نعم', onPress: () => onReapplyBatch(batch.id) },
                          ]);
                        }}>
                          <Ionicons name="refresh" size={16} color="white" />
                          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>إعادة التحديث</Text>
                        </TouchableOpacity>
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
  const years = Array.from({ length: 11 }, (_, i) => String(currentYear - 2 + i));

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

const WorkerTrackingScreen = ({ visible, onClose, workers, activityLog, amperPrices }) => {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const years = [];
  for (let yr = now.getFullYear(); yr >= now.getFullYear() - 5; yr--) years.push(String(yr));

  useEffect(() => {
    if (visible && workers.length === 1) {
      setSelectedWorker(workers[0]);
    }
  }, [visible, workers]);

  const filteredLogs = useMemo(() => {
    if (!activityLog || !Array.isArray(activityLog)) return [];
    const monthKey = `${selectedMonth}_${selectedYear}`;
    return activityLog.filter(batch => {
      if (selectedWorker && batch.workerCode !== selectedWorker.code) return false;
      return (batch.updates || []).some(u => u.monthKey === monthKey);
    });
  }, [activityLog, selectedMonth, selectedYear, selectedWorker]);

  const { collections, expenses, totalCollected, totalExpenses } = useMemo(() => {
    const monthKey = `${selectedMonth}_${selectedYear}`;
    let cols = [];
    let exps = [];
    let tc = 0;
    let te = 0;
    filteredLogs.forEach(batch => {
      (batch.updates || []).forEach(u => {
        if (u.monthKey !== monthKey) return;
        if (u.type === 'paid') {
          const amperVal = u.amper || 0;
          const price = getAmperPrice(amperPrices, monthKey);
          const amount = amperVal * price;
          cols.push({ subscriberName: u.subscriberName, amper: amperVal, amount, timestamp: u.timestamp, type: 'full' });
          tc += amount;
        } else if (u.type === 'partialPayment') {
          const amount = (u.details && u.details.amount) || 0;
          cols.push({ subscriberName: u.subscriberName, amper: u.amper || 0, amount, timestamp: u.timestamp, type: 'partial' });
          tc += amount;
        } else if (u.type === 'addExpense') {
          const expType = (u.details && u.details.expenseType) || u.subscriberName || '';
          const amount = (u.details && u.details.amount) || 0;
          exps.push({ type: expType, amount, timestamp: u.timestamp });
          te += amount;
        }
      });
    });
    return { collections: cols, expenses: exps, totalCollected: tc, totalExpenses: te };
  }, [filteredLogs, selectedMonth, selectedYear]);

  if (!visible) return null;

  return (
    <View style={{ flex: 1 }}>
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
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
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row-reverse', gap: 10, marginBottom: 16 }}>
                <TouchableOpacity style={[styles.filterTab, { flex: 1 }]} onPress={() => setYearPickerVisible(true)}>
                  <Text style={[styles.filterTabText, { color: '#1565C0' }]}>{selectedYear}</Text>
                  <Ionicons name="calendar-outline" size={16} color="#1565C0" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterTab, { flex: 1 }]} onPress={() => setMonthPickerVisible(true)}>
                  <Text style={[styles.filterTabText, { color: '#1565C0' }]}>{monthNames[parseInt(selectedMonth) - 1]}</Text>
                  <Ionicons name="calendar-outline" size={16} color="#1565C0" />
                </TouchableOpacity>
              </View>

              {workers.length > 1 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[styles.formLabel, { marginBottom: 8 }]}>اختر العامل</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row-reverse' }}>
                    {workers.map((w, idx) => (
                      <TouchableOpacity key={idx} style={[styles.filterTab, selectedWorker && selectedWorker.code === w.code && styles.filterTabActive, { marginLeft: 8 }]} onPress={() => setSelectedWorker(selectedWorker && selectedWorker.code === w.code ? null : w)}>
                        <Text style={[styles.filterTabText, selectedWorker && selectedWorker.code === w.code && styles.filterTabTextActive]}>{w.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={{ backgroundColor: '#E8F5E9', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <Text style={{ fontSize: 14, color: '#2E7D32', fontWeight: 'bold', marginBottom: 8 }}>ملخص الشهر</Text>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: '#555' }}>إجمالي المحصل:</Text>
                  <Text style={{ fontSize: 14, color: '#2E7D32', fontWeight: 'bold' }}>د.ع {formatNumber(totalCollected)}</Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: '#555' }}>إجمالي الصرفيات:</Text>
                  <Text style={{ fontSize: 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(totalExpenses)}</Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#C8E6C9', paddingTop: 6, marginTop: 4 }}>
                  <Text style={{ fontSize: 14, color: '#333', fontWeight: 'bold' }}>الصافي:</Text>
                  <Text style={{ fontSize: 15, color: totalCollected - totalExpenses >= 0 ? '#2E7D32' : '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(totalCollected - totalExpenses)}</Text>
                </View>
              </View>

              {collections.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[styles.formLabel, { marginBottom: 8, fontWeight: 'bold' }]}>التحصيلات ({collections.length})</Text>
                  {collections.map((c, idx) => (
                    <View key={idx} style={{ backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, color: '#333', fontWeight: 'bold' }}>{c.subscriberName}</Text>
                        <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{c.amper} أميبر - {c.type === 'full' ? 'دفع كامل' : 'دفع جزئي'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-start' }}>
                        <Text style={{ fontSize: 14, color: '#2E7D32', fontWeight: 'bold' }}>د.ع {formatNumber(c.amount)}</Text>
                        <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{c.timestamp}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {expenses.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[styles.formLabel, { marginBottom: 8, fontWeight: 'bold' }]}>الصرفيات ({expenses.length})</Text>
                  {expenses.map((e, idx) => (
                    <View key={idx} style={{ backgroundColor: '#FFF3E0', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, color: '#333', fontWeight: 'bold' }}>{e.type}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-start' }}>
                        <Text style={{ fontSize: 14, color: '#D32F2F', fontWeight: 'bold' }}>د.ع {formatNumber(e.amount)}</Text>
                        <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{e.timestamp}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {collections.length === 0 && expenses.length === 0 && (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Ionicons name="document-text-outline" size={60} color="#ccc" />
                  <Text style={{ fontSize: 16, color: '#999', marginTop: 10 }}>لا توجد بيانات لهذا الشهر</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
      </Modal>

      <Modal visible={monthPickerVisible} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>اختر الشهر</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {monthNames.map((m, idx) => (
                <TouchableOpacity key={idx} style={[styles.pickerItem, parseInt(selectedMonth) === idx + 1 && styles.pickerItemActive]} onPress={() => { setSelectedMonth(String(idx + 1)); setMonthPickerVisible(false); }}>
                  <Text style={[styles.pickerItemText, parseInt(selectedMonth) === idx + 1 && styles.pickerItemTextSelected]}>{m}</Text>
                  {parseInt(selectedMonth) === idx + 1 && <Ionicons name="checkmark" size={22} color="#2196F3" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={yearPickerVisible} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>اختر السنة</Text>
            <ScrollView>
              {years.map((y) => (
                <TouchableOpacity key={y} style={[styles.pickerItem, selectedYear === y && styles.pickerItemActive]} onPress={() => { setSelectedYear(y); setYearPickerVisible(false); }}>
                  <Text style={[styles.pickerItemText, selectedYear === y && styles.pickerItemTextSelected]}>{y}</Text>
                  {selectedYear === y && <Ionicons name="checkmark" size={22} color="#2196F3" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const AddSubscriberModal = ({ visible, onClose, onSave, selectedMonth, selectedYear }) => {
  const [name, setName] = useState('');
  const [amper, setAmper] = useState('');
  const [subscriberNumber, setSubscriberNumber] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [visaNumber, setVisaNumber] = useState('');
  const [subscriptionType, setSubscriptionType] = useState('normal');

  const handleSave = () => {
    const nameError = validateName(name);
    if (nameError) {
      Alert.alert('تنبيه', nameError);
      return;
    }
    const amperError = validateAmper(amper);
    if (amperError) {
      Alert.alert('تنبيه', amperError);
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
            <View style={{ padding: 20 }}>
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
                <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
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
      Alert.alert('تنبيه', nameError);
      return;
    }
    if (!isPaid) {
      const amperError = validateAmper(amper);
      if (amperError) {
        Alert.alert('تنبيه', amperError);
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
            <View style={{ padding: 20 }}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>اسم المشترك <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.formInput} value={name} onChangeText={setName} placeholderTextColor="#999" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>عدد الأمبيرات <Text style={styles.required}>*</Text></Text>
                {isPaid && <Text style={{ color: '#FF9800', fontSize: 12, marginBottom: 4 }}>لا يمكن تغيير الأمبير - المشترك دافع الشهر الحالي</Text>}
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
                <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
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

const PartialPaymentModal = ({ visible, onClose, subscriber, amperPrices, monthKey, onConfirm }) => {
  const [amount, setAmount] = useState('');
  const pmMonth = monthKey ? monthKey.split('_')[0] : '1';
  const pmYear = monthKey ? monthKey.split('_')[1] : '2026';
  const price = getAmperPrice(amperPrices, monthKey);
  const totalDue = (subscriber ? getAmperForMonth(subscriber, pmMonth, pmYear) : 0) * price;
  const existingPayments = (subscriber && subscriber.partialPayments && subscriber.partialPayments[monthKey]) || [];
  const totalPaid = existingPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const remaining = totalDue - totalPaid;

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.partialModalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>دفع جزئي</Text>
            <View style={{ width: 30 }} />
          </View>

          <View style={styles.partialSubscriberInfo}>
            <Text style={styles.partialSubscriberName}>{subscriber ? subscriber.name : ''}</Text>
            <Text style={styles.partialSubscriberAmper}>{subscriber ? getAmperForMonth(subscriber, pmMonth, pmYear) : 0} أميبر</Text>
          </View>

          <View style={styles.partialSummary}>
            <View style={styles.partialSummaryRow}>
              <Text style={styles.partialSummaryLabel}>المبلغ الواجب دفعه</Text>
              <Text style={styles.partialSummaryValue}>د.ع {formatNumber(totalDue)}</Text>
            </View>
            <View style={styles.partialSummaryRow}>
              <Text style={styles.partialSummaryLabel}>الواصل</Text>
              <Text style={[styles.partialSummaryValue, styles.partialPaid]}>د.ع {formatNumber(totalPaid)}</Text>
            </View>
            <View style={styles.partialSummaryRow}>
              <Text style={styles.partialSummaryLabel}>المتبقي</Text>
              <Text style={[styles.partialSummaryValue, styles.partialRemaining]}>د.ع {formatNumber(remaining)}</Text>
            </View>
          </View>

          <View style={styles.partialInputGroup}>
            <Text style={styles.partialInputLabel}>ادخل مبلغ الدفع</Text>
            <TextInput
              style={styles.partialInput}
              value={amount}
              onChangeText={(t) => {
                const raw = t.replace(/[^0-9]/g, '');
                if (raw) {
                  setAmount(formatNumber(parseInt(raw)));
                } else {
                  setAmount('');
                }
              }}
              placeholder="0"
              placeholderTextColor="#999"
              keyboardType="numeric"
              textAlign="center"
            />
          </View>

          <TouchableOpacity style={styles.partialConfirmButton} onPress={() => {
            const parsed = parseFloat(amount.replace(/,/g, ''));
            if (!parsed || parsed <= 0) {
              Alert.alert('خطأ', 'أدخل مبلغ صحيح');
              return;
            }
            if (parsed > remaining) {
              Alert.alert('خطأ', `المبلغ المدخل أكبر من المتبقي. الحد الأقصى المسموح: ${formatNumber(remaining)} د.ع`);
              return;
            }
            onConfirm(parsed);
            setAmount('');
            onClose();
          }}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.partialConfirmText}>تأكيد الدفع</Text>
          </TouchableOpacity>

          {remaining > 0 && (
            <TouchableOpacity style={[styles.partialConfirmButton, { marginTop: 8 }]} onPress={() => {
              Alert.alert('دفع المتبقي', `هل تريد دفع المتبقي بالكامل؟\nالمبلغ: د.ع ${formatNumber(remaining)}`, [
                { text: 'إلغاء', style: 'cancel' },
                { text: 'نعم', onPress: () => { onConfirm(remaining); onClose(); } },
              ]);
            }}>
              <Ionicons name="wallet" size={22} color="white" />
              <Text style={styles.partialConfirmText}>دفع المتبقي كاملاً ({formatNumber(remaining)} د.ع)</Text>
            </TouchableOpacity>
          )}

          {existingPayments.length > 0 && (
            <View style={{ marginTop: 16, width: '100%' }}>
              <Text style={[styles.partialSummaryLabel, { textAlign: 'right', marginBottom: 8, fontSize: 14, fontWeight: 'bold', color: '#333' }]}>سجل الدفعات الجزئية</Text>
              {existingPayments.slice().reverse().map((p, idx) => (
                <View key={idx} style={{ backgroundColor: '#F5F5F5', borderRadius: 8, padding: 10, marginBottom: 6, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 14, color: '#4CAF50', fontWeight: 'bold' }}>د.ع {formatNumber(parseFloat(p.amount) || 0)}</Text>
                    {p.ownerName ? <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{p.ownerName}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 12, color: '#666' }}>{p.timestamp || '-'}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const ChangeAmperModal = ({ visible, onClose, subscriber, selectedMonth, selectedYear, onConfirm, amperPrices, onSaveAmperPrice }) => {
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
      Alert.alert('خطأ', 'أدخل عدد أمبير صحيح بين 1 و 100');
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
const SubscribersScreen = ({ visible, onClose, subscribers, onDeleteSubscriber, onSaveSubscriber, onTogglePaid, onPartialPayment, onRestoreSubscriber, amperPrices, currentUser, ownerName, onChangeAmper, onSaveAmperPrice, userRole, workerPermissions }) => {
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [searchText, setSearchText] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [addSubscriberVisible, setAddSubscriberVisible] = useState(false);
  const [partialPaymentVisible, setPartialPaymentVisible] = useState(false);
  const [partialPaymentSubscriber, setPartialPaymentSubscriber] = useState(null);
  const [changeAmperVisible, setChangeAmperVisible] = useState(false);
  const [changeAmperSubscriber, setChangeAmperSubscriber] = useState(null);
  const [editSubscriberVisible, setEditSubscriberVisible] = useState(false);
  const [editSubscriber, setEditSubscriber] = useState(null);
  const [editPickerVisible, setEditPickerVisible] = useState(false);
  const [editPickerSearch, setEditPickerSearch] = useState('');
  const [deletePickerVisible, setDeletePickerVisible] = useState(false);
  const [deletePickerSearch, setDeletePickerSearch] = useState('');
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
      setExpandedCard(null);
    }
  }, [visible]);
  const [displayCount, setDisplayCount] = useState(15);

  const PAGE_SIZE = 15;

  useEffect(() => { setDisplayCount(PAGE_SIZE); }, [selectedMonth, selectedYear, searchText, activeFilter, visible]);

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
    const vs = subscribers.filter(sub => isVisibleForMonth(sub, parseInt(selectedMonth), parseInt(selectedYear)));
    const df = subscribers.filter(sub => isDeletedForReport(sub, selectedMonth, selectedYear));
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
    });
    const fd = df.filter(sub => {
      return sub.name.includes(searchText) ||
        (sub.subscriberNumber && sub.subscriberNumber.includes(searchText)) ||
        (sub.meterNumber && sub.meterNumber.includes(searchText));
    });
    return { visibleSubscribers: vs, deletedForMonth: df, visibleCount: vc, paidCount: pc, requiredCount: rc, unpaidCount: uc, filteredSubscribers: fs, filteredDeleted: fd };
  }, [subscribers, selectedMonth, selectedYear, searchText, activeFilter, monthKey]);

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

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
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

          {(() => {
            if (!canChangeAmperPrice) return null;
            const now = new Date();
            const curMonth = now.getMonth() + 1;
            const curYear = now.getFullYear();
            const selMonth = parseInt(selectedMonth);
            const selYear = parseInt(selectedYear);
            const isFuture = (selYear > curYear) || (selYear === curYear && selMonth > curMonth);
            if (!isFuture) return null;
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
            {canDelete && (
              <TouchableOpacity style={styles.deleteSubscriberButtonHalf} onPress={() => {
                if (filteredSubscribers.length === 0) {
                  Alert.alert('تنبيه', 'لا يوجد مشتركين لحذفهم');
                  return;
                }
                setDeletePickerSearch('');
                setDeletePickerVisible(true);
              }}>
                <Text style={styles.deleteSubscriberText}>حذف مشترك</Text>
              </TouchableOpacity>
            )}
            {canEdit && (
              <TouchableOpacity style={[styles.addSubscriberButtonHalf, { backgroundColor: '#009688' }]} onPress={() => {
                if (filteredSubscribers.length === 0) {
                  Alert.alert('تنبيه', 'لا يوجد مشتركين لتعديلهم');
                  return;
                }
                setEditPickerSearch('');
                setEditPickerVisible(true);
              }}>
                <Text style={[styles.addSubscriberText, { fontSize: 13 }]}>تعديل بيانات المشترك</Text>
              </TouchableOpacity>
            )}
            {canAdd && (
              <TouchableOpacity style={styles.addSubscriberButtonHalf} onPress={() => setAddSubscriberVisible(true)}>
                <Text style={styles.addSubscriberText}>إضافة مشترك</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.searchContainer}>
            <TextInput style={styles.searchInput} placeholder="اكتب اسم المشترك للبحث..." placeholderTextColor="#999" value={searchText} onChangeText={setSearchText} textAlign="right" />
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
                      د.ع {formatNumber(getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear)) * getAmperPrice(amperPrices, `${selectedMonth}_${selectedYear}`))}    <Text style={styles.amperBlue}>{getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear))} أميبر</Text>
                    </Text>
                    {subscriber.meterNumber && subscriber.meterNumber.trim() !== '' ? <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>رقم الجوزة: {subscriber.meterNumber}</Text> : null}
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
            paginatedSubscribers.map((subscriber) => {
              const monthKey = `${selectedMonth}_${selectedYear}`;
              const currentAmper = getAmperForMonth(subscriber, selectedMonth, selectedYear);
              const historyForMonth = (subscriber.paymentHistory || []).filter(h => h.monthKey === monthKey);
              const hasMultipleActions = historyForMonth.length > 1;
              const isExpanded = expandedCard === subscriber.id;
              const price = getAmperPrice(amperPrices, monthKey);
              const totalDue = currentAmper * price;
              const partialPayments = (subscriber.partialPayments && subscriber.partialPayments[monthKey]) || [];
              const totalPartialPaid = partialPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
              const hasPartialPayments = partialPayments.length > 0;
              const hasAnyHistory = historyForMonth.length > 0 || hasPartialPayments;
              const isFullyPaid = isPaid(subscriber);

              return (
                <View key={subscriber.id}>
                  <View style={[styles.subscriberCard, isFullyPaid ? styles.paidCardBorder : styles.unpaidCardBorder]}>
                    <View style={styles.cardTopRow}>
                      {(isFullyPaid || !hasPartialPayments) && (
                      <TouchableOpacity style={styles.payCheckbox} onPress={() => {
                        setExpandedCard(null);
                        if (!price || price === 0) {
                          Alert.alert('تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                          return;
                        }
                        if (isFullyPaid) {
                          if (!canCancelPayment) {
                            Alert.alert('تنبيه', 'لا تملك صلاحية إلغاء الدفع');
                            return;
                          }
                          Alert.alert('إلغاء التسديد', `هل تريد إلغاء تسديد اشتراك "${subscriber.name}"؟`, [
                            { text: 'إلغاء', style: 'cancel' },
                            { text: 'نعم', onPress: () => onTogglePaid(subscriber.id, monthKey) },
                          ]);
                        } else {
                          if (!canEdit) {
                            Alert.alert('تنبيه', 'لا تملك صلاحية تسديد الاشتراك');
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
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.subscriberName}>{subscriber.name}</Text>
                            {subscriber.subscriptionType === 'golden' ? <View style={styles.goldenBadge}><Text style={styles.goldenBadgeText}>ذهبي</Text></View> : null}
                          </View>
                          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 2 }}>
                              <TouchableOpacity
                                onLongPress={() => {
                                  if (!canChangeAmperPrice) {
                                    Alert.alert('تنبيه', 'لا تملك صلاحية تغيير الأمبير');
                                    return;
                                  }
                                  setChangeAmperSubscriber(subscriber);
                                  setChangeAmperVisible(true);
                                }}
                                disabled={!canChangeAmperPrice}
                              >
                                <Text style={[styles.subscriberAmperTag]}>{currentAmper} أميبر</Text>
                              </TouchableOpacity>
                          {subscriber.meterNumber && subscriber.meterNumber.trim() !== '' ? <Text style={{ fontSize: 12, color: '#999' }}>رقم الجوزة: {subscriber.meterNumber}</Text> : null}
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
                                Alert.alert('تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                                return;
                              }
                              setPartialPaymentSubscriber(subscriber);
                              setPartialPaymentVisible(true);
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
                                Alert.alert('تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                                return;
                              }
                              setPartialPaymentSubscriber(subscriber);
                              setPartialPaymentVisible(true);
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
      />

      <PartialPaymentModal
        visible={partialPaymentVisible}
        onClose={() => { setPartialPaymentVisible(false); setPartialPaymentSubscriber(null); }}
        subscriber={partialPaymentSubscriber}
        amperPrices={amperPrices}        monthKey={monthKey}
        onConfirm={(amount) => onPartialPayment(partialPaymentSubscriber.id, amount, monthKey)}
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
        onClose={() => { setEditSubscriberVisible(false); setEditSubscriber(null); }}
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
              <Text style={styles.modalTitle}>اختر مشترك للحذف</Text>
              <View style={{ width: 30 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <TextInput
                style={[styles.formInput, { textAlign: 'right' }]}
                placeholder="ابحث عن مشترك..."
                placeholderTextColor="#999"
                value={deletePickerSearch}
                onChangeText={setDeletePickerSearch}
              />
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {visibleSubscribers.filter(sub =>
                sub.name.includes(deletePickerSearch) ||
                (sub.subscriberNumber && sub.subscriberNumber.includes(deletePickerSearch)) ||
                (sub.meterNumber && sub.meterNumber.includes(deletePickerSearch))
              ).map(sub => (
                <TouchableOpacity
                  key={sub.id}
                  style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}
                  onPress={() => {
                    setDeletePickerVisible(false);
                    setDeletePickerSearch('');
                    Alert.alert('حذف مشترك', `هل تريد حذف "${sub.name}" من هذا الشهر؟`, [
                      { text: 'إلغاء', style: 'cancel' },
                      { text: 'نعم', onPress: () => onDeleteSubscriber(sub.id, monthKey), style: 'destructive' },
                    ]);
                  }}
                >
                  <Text style={{ fontSize: 16, color: '#333' }}>{sub.name}</Text>
                  <Text style={{ fontSize: 14, color: '#D32F2F' }}>{sub.amper} أميبر</Text>
                </TouchableOpacity>
              ))}
              {visibleSubscribers.filter(sub =>
                sub.name.includes(deletePickerSearch) ||
                (sub.subscriberNumber && sub.subscriberNumber.includes(deletePickerSearch)) ||
                (sub.meterNumber && sub.meterNumber.includes(deletePickerSearch))
              ).length === 0 && (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: '#999', fontSize: 16 }}>لا يوجد مشتركين</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {editPickerVisible && (
        <View style={styles.addSubscriberOverlay}>
          <View style={styles.addSubscriberModalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setEditPickerVisible(false); setEditPickerSearch(''); }}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>اختر مشترك للتعديل</Text>
              <View style={{ width: 30 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <TextInput
                style={[styles.formInput, { textAlign: 'right' }]}
                placeholder="ابحث عن مشترك..."
                placeholderTextColor="#999"
                value={editPickerSearch}
                onChangeText={setEditPickerSearch}
              />
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {visibleSubscribers.filter(sub =>
                sub.name.includes(editPickerSearch) ||
                (sub.subscriberNumber && sub.subscriberNumber.includes(editPickerSearch)) ||
                (sub.meterNumber && sub.meterNumber.includes(editPickerSearch))
              ).map(sub => (
                <TouchableOpacity
                  key={sub.id}
                  style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}
                  onPress={() => {
                    setEditPickerVisible(false);
                    setEditPickerSearch('');
                    setEditSubscriber(sub);
                    setEditSubscriberVisible(true);
                  }}
                >
                  <Text style={{ fontSize: 16, color: '#333' }}>{sub.name}</Text>
                  <Text style={{ fontSize: 14, color: '#2196F3' }}>{sub.amper} أميبر</Text>
                </TouchableOpacity>
              ))}
              {visibleSubscribers.filter(sub =>
                sub.name.includes(editPickerSearch) ||
                (sub.subscriberNumber && sub.subscriberNumber.includes(editPickerSearch)) ||
                (sub.meterNumber && sub.meterNumber.includes(editPickerSearch))
              ).length === 0 && (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: '#999', fontSize: 16 }}>لا يوجد مشتركين</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      </View>
    </Modal>
  );
};

const ReportsScreen = ({ visible, onClose, subscribers, amperPrices }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedSubscriberId, setSelectedSubscriberId] = useState(null);
  const foundSub = selectedSubscriberId ? subscribers.find(s => s.id === selectedSubscriberId) : null;
  const selectedSubscriber = foundSub || null;
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSearchText('');
      setSelectedSubscriberId(null);
      setSelectedMonth('all');
    }
  }, [visible]);

  const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  const getPriceForMonth = (m, y) => getAmperPrice(amperPrices, `${m}_${y}`);

  const filteredSubscribers = useMemo(() => {
    return subscribers.filter(sub => {
      if (!sub.name.includes(searchText)) return false;
      if (sub.deletedFromMonth) {
        const delParts = sub.deletedFromMonth.split('_');
        const delMonth = parseInt(delParts[0]);
        const delYear = parseInt(delParts[1]);
        const selYear = parseInt(selectedYear);
        if (selYear > delYear) return false;
        if (selYear === delYear && parseInt(selectedMonth !== 'all' ? selectedMonth : '1') >= delMonth) return false;
      }
      return true;
    });
  }, [subscribers, searchText, selectedYear, selectedMonth]);

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
        const mPrice = getPriceForMonth(m, selectedYear);
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

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
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
              <TouchableOpacity style={styles.reportsDropdown} onPress={() => setYearPickerVisible(true)}>
                <Text style={styles.reportsDropdownText}>{selectedYear}</Text>
                <Ionicons name="calendar" size={20} color="#2196F3" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.reportsDropdown} onPress={() => setMonthPickerVisible(true)}>
                <Text style={styles.reportsDropdownText}>{selectedMonth === 'all' ? 'كل الأشهر' : selectedMonth}</Text>
                <Ionicons name="calendar" size={20} color="#2196F3" />
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
              <View style={styles.reportCard}>
                <View style={styles.reportSubscriberHeader}>
                  <Text style={styles.reportSubscriberName}>{selectedSubscriber.name}</Text>
                  <TouchableOpacity onPress={() => setSelectedSubscriberId(null)}>
                    <Ionicons name="close-circle" size={24} color="#D32F2F" />
                  </TouchableOpacity>
                </View>

                <View style={styles.reportSummary}>
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>المبلغ الكلي</Text>
                    <Text style={styles.reportSummaryValue}>د.ع {formatNumber(reportStats.totalDue)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>المدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryPaid]}>د.ع {formatNumber(reportStats.totalPaid)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>الغير مدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryRemaining]}>د.ع {formatNumber(reportStats.totalRemaining)}</Text>
                  </View>
                </View>

                <View style={styles.reportTableHeader}>
                  <Text style={styles.reportTableHeaderText}>الشهر</Text>
                  <Text style={styles.reportTableHeaderText}>الأميبر</Text>
                  <Text style={styles.reportTableHeaderText}>المبلغ</Text>
                  <Text style={styles.reportTableHeaderText}>الحالة</Text>
                  <Text style={styles.reportTableHeaderText}>التاريخ</Text>
                </View>

                {monthsToShow.map(m => {
                  const monthKey = `${m}_${selectedYear}`;
                  const subAddedMonth = selectedSubscriber.addedMonth ? parseInt(selectedSubscriber.addedMonth) : 1;
                  const subAddedYear = selectedSubscriber.addedYear ? parseInt(selectedSubscriber.addedYear) : new Date().getFullYear();
                  const isBeforeAdded = (parseInt(selectedYear) < subAddedYear) || (parseInt(selectedYear) === subAddedYear && parseInt(m) < subAddedMonth);

                  if (isBeforeAdded) {
                    return (
                      <View key={m} style={[styles.reportTableRow, { backgroundColor: '#F5F5F5' }]}>
                        <Text style={[styles.reportTableCell, { color: '#BBB' }]}>{m}/{selectedYear}</Text>
                        <Text style={[styles.reportTableCell, { color: '#BBB' }]}>-</Text>
                        <Text style={[styles.reportTableCell, { color: '#BBB' }]}>-</Text>
                        <View style={[styles.reportStatusBadge, { backgroundColor: '#E0E0E0' }]}>
                          <Text style={[styles.reportStatusText, { color: '#999' }]}>لم يُضَف بعد</Text>
                        </View>
                        <View style={{flex: 1.5}}>
                          <Text style={[styles.reportTableCellSmall, { color: '#BBB' }]}>-</Text>
                        </View>
                      </View>
                    );
                  }

                  const deleted = isDeletedForReport(selectedSubscriber, m, selectedYear);

                  if (deleted) {
                    return (
                      <View key={m} style={[styles.reportTableRow, { backgroundColor: '#FFF3E0' }]}>
                        <Text style={styles.reportTableCell}>{m}/{selectedYear}</Text>
                        <Text style={styles.reportTableCell}>-</Text>
                        <Text style={styles.reportTableCell}>-</Text>
                        <View style={[styles.reportStatusBadge, { backgroundColor: '#FF9800' }]}>
                          <Text style={styles.reportStatusText}>تم الحذف</Text>
                        </View>
                        <View style={{flex: 1.5}}>
                          <Text style={styles.reportTableCellSmall}>{selectedSubscriber.deletedAt || '-'}</Text>
                          {selectedSubscriber.deletedByOwner ? <Text style={styles.reportTableCellSmall}>{selectedSubscriber.deletedByOwner}</Text> : null}
                        </View>
                      </View>
                    );
                  }

                  const isPaid = selectedSubscriber.paidMonths && selectedSubscriber.paidMonths[monthKey];
                  const history = (selectedSubscriber.paymentHistory || []).filter(h => h.monthKey === monthKey);
                  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
                  const rowAmper = getAmperForMonth(selectedSubscriber, m, selectedYear);
                  const rowPrice = getPriceForMonth(m, selectedYear);
                  const priceNotSet = !rowPrice || rowPrice === 0;
                  const rowPartialPayments = (selectedSubscriber.partialPayments && selectedSubscriber.partialPayments[monthKey]) || [];
                  const rowPartialSum = rowPartialPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
                  const hasRowPartial = rowPartialPayments.length > 0 && !isPaid;

                  return (
                    <View key={m} style={[styles.reportTableRow, priceNotSet ? styles.reportRowUnpaid : (isPaid ? styles.reportRowPaid : styles.reportRowUnpaid)]}>
                      <Text style={styles.reportTableCell}>{m}/{selectedYear}</Text>
                      <Text style={[styles.reportTableCell, styles.amperBlue]}>{rowAmper}</Text>
                      <Text style={styles.reportTableCell}>{priceNotSet ? 'لم يتم تحديد السعر بعد' : `د.ع ${formatNumber(rowAmper * rowPrice)}`}</Text>
                      {priceNotSet ? null : (
                        <View style={[styles.reportStatusBadge, isPaid ? styles.reportStatusPaid : (hasRowPartial ? styles.reportStatusPartial : styles.reportStatusUnpaid)]}>
                          <Text style={styles.reportStatusText}>{isPaid ? 'مدفوع' : (hasRowPartial ? `جزئي ${formatNumber(rowPartialSum)}` : 'غير مدفوع')}</Text>
                        </View>
                      )}
                      <View style={{flex: 1.5}}>
                        <Text style={styles.reportTableCellSmall}>{lastEntry ? lastEntry.timestamp : '-'}</Text>
                        {lastEntry && lastEntry.ownerName ? <Text style={styles.reportTableCellSmall}>{lastEntry.ownerName}</Text> : null}
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
            Alert.alert('تنبيه', 'ادخل اسم المولد');
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

const MonthlyDataScreen = ({ visible, onClose, subscribers, amperPrices, monthlyExpenses }) => {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);

  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  useEffect(() => {
    if (visible) {
      setSelectedYear(String(now.getFullYear()));
      setSelectedMonth(String(now.getMonth() + 1));
    }
  }, [visible]);

  const m = parseInt(selectedMonth);
  const y = parseInt(selectedYear);
  const monthKey = `${m}_${y}`;

  const price = getAmperPrice(amperPrices, monthKey);

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
      if (isDeleted) { deletedCount++; return; }
      activeCount++;
      const subAmper = getAmperForMonth(s, m, y);
      totalAmper += subAmper;
      const monthDue = subAmper * price;
      totalExpected += monthDue;
      const isPaid = s.paidMonths && s.paidMonths[monthKey];
      const pp = s.partialPayments && s.partialPayments[monthKey];
      if (isPaid) {
        paidCount++;
        totalCollected += monthDue;
      } else if (pp && pp.length > 0) {
        requiredCount++;
        const ppSum = pp.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        totalCollected += ppSum;
        requiredAmount += monthDue - ppSum;
      } else { unpaidCount++; }
    });
    return { activeCount, deletedCount, totalAmper, paidCount, unpaidCount, requiredCount, requiredAmount, totalExpected, totalCollected };
  }, [subscribers, m, y, monthKey, price]);

  const monthExpenses = monthlyExpenses[monthKey] || { gas: '0', oil: '0', repairs: '0', salaries: '0' };
  const totalExpenses = (parseFloat(monthExpenses.gas) || 0) + (parseFloat(monthExpenses.oil) || 0) + (parseFloat(monthExpenses.repairs) || 0) + (parseFloat(monthExpenses.salaries) || 0);
  const netProfit = stats.totalCollected - totalExpenses;

  const years = [];
  for (let yr = now.getFullYear(); yr >= now.getFullYear() - 5; yr--) years.push(String(yr));

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { flex: 1, paddingTop: 40 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-forward" size={26} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>بيانات كل شهر</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row-reverse', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
              <TouchableOpacity style={[styles.filterTab, { flex: 1 }]} onPress={() => setYearPickerVisible(true)}>
                <Text style={[styles.filterTabText, { color: '#1565C0' }]}>{selectedYear}</Text>
                <Ionicons name="calendar-outline" size={16} color="#1565C0" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterTab, { flex: 1 }]} onPress={() => setMonthPickerVisible(true)}>
                <Text style={[styles.filterTabText, { color: '#1565C0' }]}>{m}/{selectedYear}</Text>
                <Ionicons name="chevron-down" size={16} color="#1565C0" />
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

            <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <View style={{ height: 1, backgroundColor: '#ddd', marginBottom: 12 }} />

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Ionicons name="cash" size={22} color="#1565C0" />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#333' }}>المتوقع</Text>
              </View>
              <View style={[styles.settingsInput, { backgroundColor: '#E3F2FD', borderColor: '#1565C0', borderWidth: 1 }]}>
                <Text style={{ fontSize: 15, color: '#0D47A1', fontWeight: '600' }}>د.ع {formatNumber(stats.totalExpected)}</Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 16 }}>
                <Ionicons name="wallet" size={22} color="#4CAF50" />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#333' }}>المبلغ المستوفى من المشتركين</Text>
              </View>
              <View style={[styles.settingsInput, { backgroundColor: '#E8F5E9', borderColor: '#4CAF50', borderWidth: 1 }]}>
                <Text style={{ fontSize: 15, color: '#1B5E20', fontWeight: '600' }}>د.ع {formatNumber(stats.totalCollected)}</Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 16 }}>
                <Ionicons name="alert-circle" size={22} color="#FF9800" />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#333' }}>المطلوبين</Text>
              </View>
              <View style={[styles.settingsInput, { backgroundColor: '#FFF3E0', borderColor: '#FF9800', borderWidth: 1 }]}>
                <Text style={{ fontSize: 15, color: '#E65100', fontWeight: '600' }}>د.ع {formatNumber(stats.requiredAmount)}</Text>
              </View>

              <View style={{ height: 1, backgroundColor: '#ddd', marginVertical: 16 }} />

              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Ionicons name="receipt" size={22} color="#F44336" />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#333' }}>الصرفيات</Text>
              </View>

              <View style={{ gap: 10 }}>
                <View>
                  <Text style={{ fontSize: 13, color: '#666', marginBottom: 4, textAlign: 'right' }}>وقود</Text>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5' }]}>
                    <Text style={{ fontSize: 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.gas) || 0)}</Text>
                  </View>
                </View>
                <View>
                  <Text style={{ fontSize: 13, color: '#666', marginBottom: 4, textAlign: 'right' }}>زيت</Text>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5' }]}>
                    <Text style={{ fontSize: 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.oil) || 0)}</Text>
                  </View>
                </View>
                <View>
                  <Text style={{ fontSize: 13, color: '#666', marginBottom: 4, textAlign: 'right' }}>صيانة</Text>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5' }]}>
                    <Text style={{ fontSize: 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.repairs) || 0)}</Text>
                  </View>
                </View>
                <View>
                  <Text style={{ fontSize: 13, color: '#666', marginBottom: 4, textAlign: 'right' }}>رواتب</Text>
                  <View style={[styles.settingsInput, { backgroundColor: '#f5f5f5' }]}>
                    <Text style={{ fontSize: 15, color: '#333' }}>د.ع {formatNumber(parseFloat(monthExpenses.salaries) || 0)}</Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 14, padding: 14, backgroundColor: '#FFEBEE', borderRadius: 10 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#333' }}>مجموع الصرفيات</Text>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#F44336' }}>د.ع {formatNumber(totalExpenses)}</Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 10, padding: 14, backgroundColor: netProfit >= 0 ? '#E8F5E9' : '#FFEBEE', borderRadius: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>صافي الربح</Text>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: netProfit >= 0 ? '#4CAF50' : '#F44336' }}>د.ع {formatNumber(netProfit)}</Text>
              </View>
            </View>

            <View style={{ height: 30 }} />
          </ScrollView>
        </View>

        {yearPickerVisible && (
          <Modal visible={yearPickerVisible} transparent animationType="slide">
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setYearPickerVisible(false)}>
              <View style={[styles.partialModalContent, { maxHeight: '50%' }]} onStartShouldSetResponder={() => true}>
                <Text style={styles.modalTitle}>اختر السنة</Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {years.map(yr => (
                    <TouchableOpacity key={yr} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' }} onPress={() => { setSelectedYear(yr); setYearPickerVisible(false); }}>
                      <Text style={{ fontSize: 18, color: yr === selectedYear ? '#1565C0' : '#333', fontWeight: yr === selectedYear ? 'bold' : 'normal' }}>{yr}</Text>
                      {yr === selectedYear && <Ionicons name="checkmark" size={20} color="#1565C0" style={{ marginRight: 8 }} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        )}

        {monthPickerVisible && (
          <Modal visible={monthPickerVisible} transparent animationType="slide">
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMonthPickerVisible(false)}>
              <View style={[styles.partialModalContent, { maxHeight: '50%' }]} onStartShouldSetResponder={() => true}>
                <Text style={styles.modalTitle}>اختر الشهر</Text>
                <ScrollView style={{ maxHeight: 350 }}>
                  {monthNames.map((name, idx) => (
                    <TouchableOpacity key={idx + 1} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' }} onPress={() => { setSelectedMonth(String(idx + 1)); setMonthPickerVisible(false); }}>
                      <Text style={{ fontSize: 18, color: (idx + 1) === m ? '#1565C0' : '#333', fontWeight: (idx + 1) === m ? 'bold' : 'normal' }}>{idx + 1}</Text>
                      {(idx + 1) === m && <Ionicons name="checkmark" size={20} color="#1565C0" style={{ marginRight: 8 }} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        )}
      </View>
    </Modal>
  );
};

const MainScreen = ({ currentUser, generatorName, onOpenSettings, onShowSubscribers, onShowReports, subscribers, amperPrices, onSetAmperPrice, expenses, onSetExpenses, onLogout, isOnline, generators, onAddGenerator, onSwitchGenerator, onShowMonthlyData, darkMode, pendingUpdatesCount, onShowWorkerTracking, workers }) => {
  const theme = darkMode ? { bg: '#121212', card: '#1e1e1e', text: '#fff', subText: '#aaa', border: '#333' } : { bg: '#f5f5f5', card: 'white', text: '#333', subText: '#666', border: '#ddd' };
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;

  const [localAmperPrice, setLocalAmperPrice] = useState(amperPrices[currentMonthKey] ? String(amperPrices[currentMonthKey]) : '');
  const [gas, setGas] = useState(expenses.gas || '');
  const [oil, setOil] = useState(expenses.oil || '');
  const [repairs, setRepairs] = useState(expenses.repairs || '');
  const [salaries, setSalaries] = useState(expenses.salaries || '');
  const [addExpenseVisible, setAddExpenseVisible] = useState(false);
  const [addExpenseField, setAddExpenseField] = useState(null);
  const [addExpenseAmount, setAddExpenseAmount] = useState('');
  const [addExpenseLabel, setAddExpenseLabel] = useState('');

  useEffect(() => {
    setLocalAmperPrice(String(amperPrices[currentMonthKey] || ''));
    setGas(expenses.gas);
    setOil(expenses.oil);
    setRepairs(expenses.repairs);
    setSalaries(expenses.salaries);
  }, [amperPrices, expenses]);

  const stats = useMemo(() => {
    const price = parseFloat(localAmperPrice) || 0;
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
      const isPaid = s.paidMonths && s.paidMonths[currentMonthKey];
      const pp = s.partialPayments && s.partialPayments[currentMonthKey];
      const hasPartial = pp && pp.length > 0;
      if (isPaid) {
        paidCount++;
        collectedAmount += amp * price;
      } else if (hasPartial) {
        requiredCount++;
        const ppSum = pp.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
        collectedAmount += ppSum;
      } else {
        unpaidCount++;
      }
    });
    const expectedAmount = totalAmper * price;
    const totalExpenses = (parseFloat(gas) || 0) + (parseFloat(oil) || 0) +
      (parseFloat(repairs) || 0) + (parseFloat(salaries) || 0);
    const netExpected = collectedAmount - totalExpenses;
    return { totalSubscribers: visibleCount, totalAmper, paidCount, requiredCount, unpaidCount, collectedAmount, expectedAmount, totalExpenses, netExpected, price };
  }, [subscribers, localAmperPrice, gas, oil, repairs, salaries, currentMonth, currentYear, currentMonthKey]);

  const { totalSubscribers, totalAmper, paidCount, requiredCount, unpaidCount, collectedAmount, expectedAmount, totalExpenses, netExpected, price } = stats;

  const getCurrentDate = () => {
    const now = new Date();
    return `${now.getMonth() + 1} / ${now.getFullYear()}`;
  };

  const handleAmperPriceChange = (val) => {
    const clean = onlyDigits(val);
    setLocalAmperPrice(clean);
    onSetAmperPrice(currentMonthKey, clean);
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

  return (
    <View style={[styles.mainContainer, darkMode && { backgroundColor: '#121212' }]}>
      <StatusBar backgroundColor={isOnline ? "#2196F3" : "#FF5722"} barStyle="light-content" />
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="white" />
          <Text style={styles.offlineBannerText}>لا يوجد اتصال بالإنترنت - البيانات قد لا تُحفظ</Text>
        </View>
      )}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.menuButton} onPress={onOpenSettings}>
            <Ionicons name="settings-outline" size={26} color="white" />
            {pendingUpdatesCount > 0 && (
              <View style={{ position: 'absolute', top: -4, left: -4, backgroundColor: '#F44336', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>{pendingUpdatesCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{generatorName || 'نظام الجباية'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={[styles.scrollView, darkMode && { backgroundColor: '#121212' }]} showsVerticalScrollIndicator={false}>
        <View style={styles.actionButtons}>
          <TouchableOpacity style={[styles.addButton, { paddingHorizontal: 12, paddingVertical: 8 }]} onPress={onAddGenerator}>
            <Ionicons name="add-circle-outline" size={16} color="white" />
            <Text style={[styles.addButtonText, { fontSize: 13 }]}>إضافة مولد</Text>
          </TouchableOpacity>
          {generators && generators.length > 1 && (
            <TouchableOpacity style={[styles.addButton, { paddingHorizontal: 12, paddingVertical: 8 }]} onPress={onSwitchGenerator}>
              <Ionicons name="swap-horizontal-outline" size={16} color="white" />
              <Text style={[styles.addButtonText, { fontSize: 13 }]}>تبديل المولد ({generators.length})</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.monthlyDataButton} onPress={onShowMonthlyData}>
            <Text style={styles.monthlyDataButtonText}>بيانات كل شهر</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dateContainer}>
          <Text style={styles.dateText}>{getCurrentDate()}</Text>
        </View>

        <View style={[styles.priceSection, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }, { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }]}>
          <Text style={[styles.priceLabel, darkMode && { color: '#fff' }, { marginBottom: 0, flex: 1 }]}>سعر الأميبر - شهر {currentMonth} (د.ع)</Text>
          <TextInput style={[styles.priceInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }, { flex: 1 }]} value={localAmperPrice ? formatNumber(localAmperPrice) : ''} onChangeText={handleAmperPriceChange} keyboardType="numeric" textAlign="center" placeholder="0" placeholderTextColor="#999" />
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
              <Ionicons name="flash" size={14} color="#FF9800" />
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

        <View style={styles.bottomButtons}>
          <TouchableOpacity style={styles.reportsButton} onPress={onShowReports}>
            <Text style={styles.reportsButtonText}>التقارير</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.showSubscribersButton} onPress={onShowSubscribers}>
            <Ionicons name="people" size={20} color="white" />
            <Text style={styles.showSubscribersText}>عرض المشتركين</Text>
          </TouchableOpacity>
          {workers && workers.length > 0 && (
            <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#9C27B0', marginTop: 10 }]} onPress={onShowWorkerTracking}>
              <Ionicons name="person-outline" size={20} color="white" />
              <Text style={styles.showSubscribersText}>متابعة العامل</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.financialSummary, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, darkMode && { color: '#aaa' }]}>المتوقع:</Text>
            <Text style={[styles.summaryValue, darkMode && { color: '#fff' }]}>د.ع {formatNumber(expectedAmount)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, darkMode && { color: '#aaa' }]}>المبلغ المستوفى من المشتركين:</Text>
            <Text style={[styles.summaryValue, styles.collectedValue, darkMode && { color: '#4CAF50' }]}>د.ع {formatNumber(collectedAmount)}</Text>
          </View>
        </View>

        <View style={[styles.expensesSection, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }]}>
          <View style={styles.expensesHeader}>
            <Ionicons name="wallet-outline" size={24} color="#4CAF50" />
            <Text style={[styles.expensesTitle, darkMode && { color: '#fff' }]}>الصرفيات</Text>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('gas', 'كاز')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={gas ? formatNumber(gas) : ''} onChangeText={(v) => handleExpenseChange('gas', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="water" size={16} color="#2196F3" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>كاز</Text>
            </View>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('oil', 'دهن')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={oil ? formatNumber(oil) : ''} onChangeText={(v) => handleExpenseChange('oil', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="flask" size={16} color="#9C27B0" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>دهن</Text>
            </View>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('repairs', 'إصلاحات')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={repairs ? formatNumber(repairs) : ''} onChangeText={(v) => handleExpenseChange('repairs', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="build" size={16} color="#FF5722" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>إصلاحات</Text>
            </View>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('salaries', 'رواتب')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={[styles.expenseInput, darkMode && { backgroundColor: '#2a2a2a', color: '#fff', borderColor: '#444' }]} value={salaries ? formatNumber(salaries) : ''} onChangeText={(v) => handleExpenseChange('salaries', onlyDigits(v))} keyboardType="numeric" placeholder="0" placeholderTextColor="#999" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="people" size={16} color="#607D8B" />
              <Text style={[styles.expenseLabel, darkMode && { color: '#ccc' }]}>رواتب</Text>
            </View>
          </View>
        </View>

        <View style={[styles.netExpectedContainer, darkMode && { backgroundColor: '#1e1e1e', borderColor: '#333' }, netExpected < 0 && styles.netExpectedNegative]}>
          <Text style={[styles.netExpectedLabel, darkMode && { color: '#aaa' }]}>الصافي:</Text>
          <Text style={[styles.netExpectedValue, netExpected < 0 && styles.netExpectedValueNegative]}>
            {netExpected < 0 ? `${formatNumber(Math.abs(netExpected))} - د.ع` : `د.ع ${formatNumber(netExpected)}`}
          </Text>
        </View>

      </ScrollView>

      <Modal visible={addExpenseVisible} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center' }]}>
          <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 24, width: '80%', alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 16, color: '#333' }}>إضافة مبلغ - {addExpenseLabel}</Text>
            <View style={{ backgroundColor: '#F5F5F5', borderRadius: 10, padding: 10, marginBottom: 12, width: '100%' }}>
              <Text style={{ fontSize: 14, color: '#666', textAlign: 'center' }}>المبلغ الحالي: د.ع {formatNumber(parseInt(onlyDigits(addExpenseField === 'gas' ? gas : addExpenseField === 'oil' ? oil : addExpenseField === 'repairs' ? repairs : salaries)) || 0)}</Text>
            </View>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 18, width: '100%', textAlign: 'center', marginBottom: 16 }}
              value={addExpenseAmount ? formatNumber(parseInt(onlyDigits(addExpenseAmount))) : ''}
              onChangeText={(t) => setAddExpenseAmount(onlyDigits(t))}
              placeholder="المبلغ المضاف"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
            <View style={{ flexDirection: 'row-reverse', gap: 12, width: '100%' }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#4CAF50', borderRadius: 10, padding: 12, alignItems: 'center' }}
                onPress={handleConfirmAddExpense}
              >
                <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>إدخال</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#eee', borderRadius: 10, padding: 12, alignItems: 'center' }}
                onPress={() => setAddExpenseVisible(false)}
              >
                <Text style={{ color: '#666', fontSize: 16, fontWeight: 'bold' }}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const WorkerMainScreen = ({ generatorName, onShowSubscribers, onShowReports, subscribers, amperPrices, onLogout, isOnline, workerUpdates, onSync, workerName, generators, workerPermissions, onSwitchGenerator, onShowWorkerSwitchGenerator, workerAssignedGenerators, onAddExpense }) => {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [expenseType, setExpenseType] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  const handleSaveExpense = () => {
    if (!expenseType.trim()) {
      Alert.alert('تنبيه', 'أدخل نوع الصرفية');
      return;
    }
    const parsed = parseFloat(expenseAmount.replace(/,/g, ''));
    if (!parsed || parsed <= 0) {
      Alert.alert('تنبيه', 'أدخل مبلغ صحيح');
      return;
    }
    onAddExpense(expenseType.trim(), parsed, currentMonthKey);
    setExpenseType('');
    setExpenseAmount('');
    setExpenseModalVisible(false);
    Alert.alert('تم', 'تم تسجيل الصرفية بنجاح');
  };

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
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Ionicons name="log-out-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{generatorName || 'واجهة العامل'}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 }}>{workerName}</Text>
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
          <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#FF5722', marginTop: 10 }]} onPress={() => setExpenseModalVisible(true)}>
            <Ionicons name="receipt-outline" size={20} color="white" />
            <Text style={styles.showSubscribersText}>إضافة صرفية</Text>
          </TouchableOpacity>
        </View>

        {workerUpdates.length > 0 && isOnline && (
          <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#2196F3', marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]} onPress={onSync}>
            <Ionicons name="cloud-upload-outline" size={20} color="white" />
            <Text style={styles.showSubscribersText}>رفع التحديثات ({workerUpdates.length})</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={expenseModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingTop: 20, paddingBottom: 30 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setExpenseModalVisible(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>إضافة صرفية</Text>
              <View style={{ width: 30 }} />
            </View>
            <View style={{ padding: 16 }}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>نوع الصرفية <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.formInput} value={expenseType} onChangeText={setExpenseType} placeholder="مثال: دهن، كاز، صيانة" placeholderTextColor="#999" textAlign="right" />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>المبلغ <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.formInput} value={expenseAmount} onChangeText={(t) => { const raw = t.replace(/[^0-9]/g, ''); setExpenseAmount(raw ? formatNumber(parseInt(raw)) : ''); }} placeholder="0" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
              </View>
              <TouchableOpacity style={[styles.saveSubscriberButton, { backgroundColor: '#FF5722' }]} onPress={handleSaveExpense}>
                <Ionicons name="checkmark-circle" size={22} color="white" />
                <Text style={styles.saveSubscriberText}>حفظ الصرفية</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default function App() {
  const [screen, setScreen] = useState('login');
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [generatorName, setGeneratorName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [subscribersVisible, setSubscribersVisible] = useState(false);
  const [reportsVisible, setReportsVisible] = useState(false);
  const [subscribers, setSubscribers] = useState([]);
  const [amperPrices, setAmperPrices] = useState({});
  const [monthlyExpenses, setMonthlyExpenses] = useState({});
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
  const [addGeneratorVisible, setAddGeneratorVisible] = useState(false);
  const [switchGeneratorVisible, setSwitchGeneratorVisible] = useState(false);
  const [workerAssignedGeneratorId, setWorkerAssignedGeneratorId] = useState(null);
  const [workerAssignedGenerators, setWorkerAssignedGenerators] = useState([]);
  const [workerSwitchGeneratorVisible, setWorkerSwitchGeneratorVisible] = useState(false);
  const [newWorkerCredentials, setNewWorkerCredentials] = useState(null);
  const [updatesModalVisible, setUpdatesModalVisible] = useState(false);
  const [monthlyDataVisible, setMonthlyDataVisible] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [deletedGenerators, setDeletedGenerators] = useState([]);
  const [globalLoading, setGlobalLoading] = useState('');
  const lastActivity = React.useRef(Date.now());

  const SESSION_TIMEOUT = 30 * 60 * 1000;

  useEffect(() => {
    let done = false;
    const safeFinish = () => { if (!done) { done = true; setIsLoading(false); } };
    const timer = setTimeout(safeFinish, 5000);
    const init = async () => {
      try {
        await checkLoggedIn();
      } catch (e) {
        // silent
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
    if (!currentUser || userRole !== 'owner') return;
    const checkDeleted = async () => {
      try {
        const usersResult = await loadFromFile('registered_users');
        if (usersResult === null) return;
        const usersList = usersResult || [];
        const exists = usersList.find(function(u) { return u.phone === currentUser; });
        if (!exists) {
          Alert.alert('تم الحذف', 'تم حذف حسابك من قبل الإدارة. سيتم تسجيل الخروج تلقائياً.');
          handleLogout();
        }
      } catch (e) {}
    };
    checkDeleted();
    const interval = setInterval(checkDeleted, 60000);
    return () => clearInterval(interval);
  }, [currentUser, userRole]);

  const isFirstRender = React.useRef(true);
  const generatorsRef = React.useRef(generators);
  generatorsRef.current = generators;
  const currentGeneratorIdRef = React.useRef(currentGeneratorId);
  currentGeneratorIdRef.current = currentGeneratorId;
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
          return { ...g, subscribers, amperPrices, monthlyExpenses };
        }
        return g;
      });
      setGenerators(updated);
      saveUserData(currentUser, 'generators', updated);
    }, 3000);
  }, [subscribers, amperPrices, monthlyExpenses]);

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
    if (!currentUser) return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivity.current > SESSION_TIMEOUT) {
        handleLogout();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || userRole === 'worker') return;
    const pollInterval = setInterval(async () => {
      const updates = await loadUserData(currentUser, 'pending_worker_updates');
      setPendingWorkerUpdates(normalizeBatches(updates));
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [currentUser, userRole]);

  const workerSyncRef = React.useRef({ generators: generators, currentGeneratorId: currentGeneratorId });
  useEffect(() => {
    workerSyncRef.current = { generators, currentGeneratorId };
  }, [generators, currentGeneratorId]);

  useEffect(() => {
    if (userRole !== 'worker' || !workerOwnerPhone) return;
    const pollInterval = setInterval(async () => {
      try {
        const all = await loadAllUserKeys(workerOwnerPhone);
        const ownerWorkers = all.workers || [];
        const stillExists = ownerWorkers.find(function(w) { return w.code === workerCode; });
        if (!stillExists) {
          Alert.alert('تم الحذف', 'تم حذف حسابك من قبل صاحب المولد. سيتم تسجيل الخروج.');
          handleLogout();
          return;
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
            const newExpenses = workerActive.monthlyExpenses || {};
            const oldExpenses = oldActive ? (oldActive.monthlyExpenses || {}) : {};
            const subsChanged = JSON.stringify(newSubs) !== JSON.stringify(oldSubs);
            const pricesChanged = JSON.stringify(newPrices) !== JSON.stringify(oldPrices);
            const expensesChanged = JSON.stringify(newExpenses) !== JSON.stringify(oldExpenses);
            if (subsChanged || pricesChanged || expensesChanged) {
              setGenerators(all.generators);
              setSubscribers(newSubs);
              if (pricesChanged) setAmperPrices(newPrices);
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
    if (all.ownerName !== undefined) setOwnerName(all.ownerName);
    if (all.pending_worker_updates !== undefined) setPendingWorkerUpdates(normalizeBatches(all.pending_worker_updates));
    if (all.worker_activity_log !== undefined) setWorkerActivityLog(all.worker_activity_log);
    if (all.workers !== undefined) setWorkers(all.workers);
    if (all.darkMode !== undefined) setDarkMode(all.darkMode);

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
        setMonthlyExpenses(active.monthlyExpenses || {});
        if (!loadedCurrentId || loadedCurrentId !== active.id) {
          setCurrentGeneratorId(active.id);
          await saveUserData(currentUser, 'currentGeneratorId', active.id);
        }
      }
    } else {
      if (all.generatorName !== undefined) setGeneratorName(all.generatorName);
      if (all.amperPrices !== undefined) setAmperPrices(all.amperPrices);
      if (all.subscribers !== undefined) setSubscribers(all.subscribers);
      if (all.monthlyExpenses !== undefined) setMonthlyExpenses(all.monthlyExpenses);
    }
  };

  const saveCurrentGeneratorData = async (updatedGenerators) => {
    setGenerators(updatedGenerators);
    if (currentUser) await saveUserData(currentUser, 'generators', updatedGenerators);
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
    try {
      if (genId === currentGeneratorId) return;

      const updatedGenerators = generators.map(g => {
        if (g.id === currentGeneratorId) {
          return { ...g, subscribers, amperPrices, monthlyExpenses };
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
      setMonthlyExpenses(target.monthlyExpenses || {});
      if (currentUser) {
        await saveUserData(currentUser, 'generators', updatedGenerators);
        await saveUserData(currentUser, 'currentGeneratorId', genId);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء التبديل بين المولدات');
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
      const genData = { ...genToDelete, subscribers: genToDelete.subscribers || [], amperPrices: genToDelete.amperPrices || {}, monthlyExpenses: genToDelete.monthlyExpenses || {} };
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
      setMonthlyExpenses(active.monthlyExpenses || {});
      await saveUserData(currentUser, 'generators', updatedGenerators);
      await saveUserData(currentUser, 'currentGeneratorId', active.id);
      await saveUserData(currentUser, 'deletedGenerators', updatedDeleted);
      return true;
    } finally {
      setGlobalLoading('');
    }
  };

  const handleRestoreGenerator = async (genId) => {
    const entry = deletedGenerators.find(function(dg) { return dg.id === genId; });
    if (!entry) return;
    const restored = entry.data || { id: entry.id, name: entry.name, subscribers: [], amperPrices: {}, monthlyExpenses: {} };
    const updatedGenerators = [...generators, restored];
    const updatedDeleted = deletedGenerators.filter(function(dg) { return dg.id !== genId; });
    setGenerators(updatedGenerators);
    setDeletedGenerators(updatedDeleted);
    await saveUserData(currentUser, 'generators', updatedGenerators);
    await saveUserData(currentUser, 'deletedGenerators', updatedDeleted);
    Alert.alert('تم', 'تم استرداد المولد "' + entry.name + '" بنجاح');
  };

  const handleLogin = (userPhone) => {
    if (userRole === 'worker') return;
    setCurrentUser(userPhone);
    setScreen('main');
  };

  const handleOnboardingComplete = async () => {
    await saveToFile('onboarding_done', true);
    setShowOnboarding(false);
    if (currentUser) {
      loadAllUserData();
      setScreen('main');
    } else {
      setScreen('login');
    }
  };

  const handleChangePassword = async (oldPassword, newPassword) => {
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
    }
  };

  const handleLogout = async () => {
    await deleteFile('current_user');
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
    setSubscribers([]);
    setMonthlyExpenses({});
    setGenerators([]);
    setCurrentGeneratorId(null);
    setNewWorkerCredentials(null);
    setDeletedGenerators([]);
    setScreen('login');
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

  const handleWorkerAddExpense = (expenseType, amount, monthKey) => {
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
        updates: workerUpdates,
      };
      const merged = [...existing, batch];
      const result = await saveUserData(workerOwnerPhone, 'pending_worker_updates', merged);
      const existingLog = await loadUserData(workerOwnerPhone, 'worker_activity_log') || [];
      const logBatch = { ...batch, status: 'pending' };
      await saveUserData(workerOwnerPhone, 'worker_activity_log', [...existingLog, logBatch]);
      if (result !== undefined) {
        setWorkerUpdates([]);
        Alert.alert('تم', 'تم رفع التحديثات بنجاح');
      } else {
        console.warn('Worker sync failed: saveUserData returned undefined');
        Alert.alert('خطأ', 'فشل رفع التحديثات');
      }
    } catch (e) {
      console.warn('Worker sync exception:', e);
      Alert.alert('خطأ', 'فشل رفع التحديثات');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleApplyBatch = async (batchId) => {
    if (pendingWorkerUpdates.length === 0) return;
    const batch = pendingWorkerUpdates.find(b => b.id === batchId);
    if (!batch) return;

    setGlobalLoading('جاري تطبيق التحديثات...');
    let newSubs = [...subscribers];
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
            const totalDue = getAmperForMonth(sub, parseInt(pmParts[0]), parseInt(pmParts[1])) * getAmperPrice(amperPrices, update.monthKey);
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
          break;
        }
      }
    }

    setSubscribers(newSubs);
    const remainingBatches = pendingWorkerUpdates.filter(b => b.id !== batchId);
    const existingLog = await loadUserData(currentUser, 'worker_activity_log') || [];
    const updatedLog = existingLog.map(b => b.id === batchId ? { ...b, status: 'applied' } : b);
    await saveUserData(currentUser, 'worker_activity_log', updatedLog);
    if (currentGeneratorId && generators.length > 0) {
      const updated = generators.map(g => g.id === currentGeneratorId ? { ...g, subscribers: newSubs } : g);
      setGenerators(updated);
      await Promise.all([
        saveUserData(currentUser, 'subscribers', newSubs),
        saveUserData(currentUser, 'generators', updated),
        saveUserData(currentUser, 'pending_worker_updates', remainingBatches),
      ]);
    } else {
      await Promise.all([
        saveUserData(currentUser, 'subscribers', newSubs),
        saveUserData(currentUser, 'pending_worker_updates', remainingBatches),
      ]);
    }
    setPendingWorkerUpdates(remainingBatches);
    setUpdatesModalVisible(false);
    setGlobalLoading('');
    Alert.alert('تم', 'تم تطبيق التحديثات بنجاح');
  };

  const handleDeleteBatch = async (batchId) => {
    try {
      const batch = pendingWorkerUpdates.find(b => b.id === batchId);
      const remaining = pendingWorkerUpdates.filter(b => b.id !== batchId);
      setPendingWorkerUpdates(remaining);
      await saveUserData(currentUser, 'pending_worker_updates', remaining);
      if (batch) {
        const log = await loadUserData(currentUser, 'worker_activity_log') || [];
        log.push({ ...batch, status: 'rejected' });
        await saveUserData(currentUser, 'worker_activity_log', log);
        setWorkerActivityLog(log);
      }
      Alert.alert('تم', 'تم حذف التحديث');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حذف التحديث');
    }
  };

  const handleReapplyBatch = async (batchId) => {
    try {
      const log = await loadUserData(currentUser, 'worker_activity_log') || [];
      const batch = log.find(b => b.id === batchId);
      if (!batch) {
        Alert.alert('خطأ', 'الدفعة غير موجودة');
        return;
      }
      const restoredBatch = { ...batch, status: 'pending', id: Date.now().toString() + Math.random().toString(36).substr(2, 5) };
      const existing = await loadUserData(currentUser, 'pending_worker_updates') || [];
      const updated = [...existing, restoredBatch];
      await saveUserData(currentUser, 'pending_worker_updates', updated);
      setPendingWorkerUpdates(updated);
      const updatedLog = log.map(b => b.id === batchId ? { ...b, status: 'restored' } : b);
      await saveUserData(currentUser, 'worker_activity_log', updatedLog);
      setWorkerActivityLog(updatedLog);
      Alert.alert('تم', 'تمت إعادة الدفعة إلى قائمة التحديثات المعلقة');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء إعادة التحديث');
    }
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

  const handleExport = async () => {
    try {
      const filePath = await exportUserData(currentUser);
      if (!filePath) {
        Alert.alert('تنبيه', 'لا توجد بيانات للتصدير');
        return;
      }
      await Sharing.shareAsync(filePath, {
        mimeType: 'application/json',
        dialogTitle: 'تصدير بيانات نظام الجباية',
      });
    } catch (e) {
      Alert.alert('خطأ', 'فشل التصدير');
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const fileUri = result.assets[0].uri;
      const importResult = await importUserData(fileUri);
      if (importResult.success) {
        if (importResult.phone === currentUser) {
          await loadAllUserData();
          Alert.alert('نجاح', 'تم استيراد البيانات بنجاح');
        } else {
          Alert.alert('تنبيه', 'الملف يخص مستخدم آخر');
        }
      } else {
        Alert.alert('خطأ', importResult.error);
      }
    } catch (e) {
      Alert.alert('خطأ', 'فشل الاستيراد');
    }
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
    setOwnerName(name);
    if (currentUser) await saveUserData(currentUser, 'ownerName', name);
  };

  const saveAmperPrice = async (monthKey, price) => {
    const newPrices = { ...amperPrices, [monthKey]: price };
    setAmperPrices(newPrices);
    if (currentUser) await saveUserData(currentUser, 'amperPrices', newPrices);
  };

  const saveExpenses = async (exp) => {
    const key = `${new Date().getMonth() + 1}_${new Date().getFullYear()}`;
    const updated = { ...monthlyExpenses, [key]: exp };
    setMonthlyExpenses(updated);
    if (currentUser) await saveUserData(currentUser, 'monthlyExpenses', updated);
  };

  const handleCreateWorker = async (permissions, assignedGenerators) => {
    setGlobalLoading('جاري إنشاء حساب العامل...');
    try {
      const code = generateWorkerCode(currentUser);
      const pin = generateWorkerPin();
      const hashedPin = await hashWorkerPin(pin);
      const newWorker = { code, pin: hashedPin, permissions, assignedGenerators: assignedGenerators || [], assignedGeneratorId: currentGeneratorId, createdAt: new Date().toISOString() };
      const updated = [...workers, newWorker];
      await saveUserData(currentUser, 'workers', updated);
      setWorkers(updated);
      setNewWorkerCredentials({ code, pin, permissions });
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء إنشاء حساب العامل');
    } finally {
      setGlobalLoading('');
    }
  };

  const handleUpdateWorker = async (code, permissions, assignedGenerators) => {
    try {
      const updated = workers.map(w => w.code === code ? { ...w, permissions, assignedGenerators: assignedGenerators || [] } : w);
      await saveUserData(currentUser, 'workers', updated);
      setWorkers(updated);
      Alert.alert('تم', 'تم تعديل صلاحيات العامل بنجاح');
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تعديل صلاحيات العامل');
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

  const handleWorkerLogin = async (code, pin, name) => {
    const usersResult = await loadFromFile('registered_users');
    const list = usersResult || [];
    for (const user of list) {
      const workers = await loadUserData(user.phone, 'workers');
      const deletedWorkers = await loadUserData(user.phone, 'deletedWorkers') || [];
      if (deletedWorkers.find(d => d.code === code.toUpperCase())) {
        return { success: false, deleted: true };
      }
      if (workers) {
        for (const w of workers) {
          if (w.code !== code.toUpperCase()) continue;
          const pinMatch = await verifyWorkerPin(w.pin, pin);
          if (!pinMatch) continue;
          const found = w;
          if (found.workerName && found.workerName !== name) {
            return { success: false, nameMismatch: true, savedName: found.workerName };
          }
          if (!found.workerName) {
            const updatedWorkers = workers.map(function(w2) {
              if (w2.code === code.toUpperCase()) {
                return Object.assign({}, w2, { workerName: name });
              }
              return w2;
            });
            await saveUserData(user.phone, 'workers', updatedWorkers);
          }
          return { success: true, ownerPhone: user.phone, permissions: found.permissions || [], assignedGeneratorId: found.assignedGeneratorId || null, assignedGenerators: found.assignedGenerators || [], savedName: found.workerName || name };
        }
      }
    }
    return { success: false };
  };

  const handleAddSubscriber = async (subscriber) => {
    resetActivity();
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
        if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
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
        if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
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
    }
  };

  const handleDeleteSubscriber = async (id, monthKey) => {
    resetActivity();
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
      if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('delete', id, sub.name, sub.amper, monthKey);
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حذف المشترك');
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
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
      const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
      const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
      const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
      const monthPrice = getAmperPrice(amperPrices, monthKey);
      const amperVal = getAmperForMonth(sub, parseInt(monthKey.split('_')[0]), parseInt(monthKey.split('_')[1]));
      const amount = amperVal * monthPrice;
      const monthName = monthKey.split('_')[0];
      const yearName = monthKey.split('_')[1];
      const newSubs = subscribers.map(s => {
        if (s.id === id) {
          const paidMonths = s.paidMonths ? { ...s.paidMonths } : {};
          paidMonths[monthKey] = !isCurrentlyPaid;
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
          return { ...s, paidMonths, paymentHistory, partialPayments };
        }
        return s;
      });
      setSubscribers(newSubs);
      if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate(isCurrentlyPaid ? 'cancelled' : 'paid', id, sub.name, sub.amper, monthKey, { amount });
      }
      if (!isCurrentlyPaid && sub.subscriberNumber && sub.subscriberNumber.trim()) {
        const payerName = userRole === 'worker' ? workerName : ownerName;
        const subTypeLabel = sub.subscriptionType === 'golden' ? 'اشتراك ذهبي' : 'اشتراك عادي';
        const msg = `إشعار دفع - ${generatorName}\n\nالعميل: ${sub.name}\nالشهر: ${monthName}/${yearName}\nنوع الاشتراك: ${subTypeLabel}\nالأمبير: ${amperVal} × سعر الأمبير: ${formatNumber(monthPrice)} د.ع\nالمبلغ الإجمالي: د.ع ${formatNumber(amount)}\nالحالة: مدفوع\n\nتم الدفع بواسطة: ${payerName}\nالتاريخ: ${timestamp}`;
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
    }
  };

  const handlePartialPayment = async (id, amount, monthKey) => {
    resetActivity();
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
          const totalDue = getAmperForMonth(s, parseInt(pmParts[0]), parseInt(pmParts[1])) * getAmperPrice(amperPrices, monthKey);
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
      if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('partialPayment', id, sub.name, sub.amper, monthKey, { amount });
      }
      if (sub && sub.subscriberNumber && sub.subscriberNumber.trim()) {
        const pmParts2 = monthKey.split('_');
        const amperVal2 = getAmperForMonth(sub, parseInt(pmParts2[0]), parseInt(pmParts2[1]));
        const pricePerAmper2 = getAmperPrice(amperPrices, monthKey);
        const totalDue2 = amperVal2 * pricePerAmper2;
        const newSub2 = newSubs.find(s => s.id === id);
        const monthPayments2 = newSub2 && newSub2.partialPayments && newSub2.partialPayments[monthKey] ? newSub2.partialPayments[monthKey] : [];
        const totalPaid2 = monthPayments2.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        const payerName2 = userRole === 'worker' ? workerName : ownerName;
        const subTypeLabel2 = sub.subscriptionType === 'golden' ? 'اشتراك ذهبي' : 'اشتراك عادي';
        const msg2 = `إشعار دفع جزئي - ${generatorName}\n\nالعميل: ${sub.name}\nالشهر: ${pmParts2[0]}/${pmParts2[1]}\nنوع الاشتراك: ${subTypeLabel2}\nالأمبير: ${amperVal2} × سعر الأمبير: ${formatNumber(pricePerAmper2)} د.ع\nالمبلغ المدفوع: د.ع ${formatNumber(amount)}\nالإجمالي: د.ع ${formatNumber(totalDue2)}\nالواصل: د.ع ${formatNumber(totalPaid2)}\nالمتبقي: د.ع ${formatNumber(totalDue2 - totalPaid2)}\n\nتم بواسطة: ${payerName2}\nالتاريخ: ${timestamp}`;
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
    }
  };

  const handleRestoreSubscriber = async (id) => {
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
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    if (userRole === 'worker' && sub) {
      trackWorkerUpdate('restore', id, sub.name, sub.amper, '');
    }
  };

  const handleChangeAmper = async (id, newAmper, monthKey) => {
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
      if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
      if (userRole === 'worker' && sub) {
        trackWorkerUpdate('edit', id, sub.name, newAmper, monthKey, { amper: newAmper });
      }
    } catch (e) {
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير الأمبير');
    }
  };

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
        onRegisterSuccess={(registeredPhone) => { setScreen('login'); setCurrentUser(registeredPhone); setUserRole('owner'); saveToFile('current_user', { phone: registeredPhone, role: 'owner' }); setShowOnboarding(true); }}
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
        onLogin={async (code, pin, name) => {
          const result = await handleWorkerLogin(code, pin, name);
          if (result.success) {
            setWorkerOwnerPhone(result.ownerPhone);
            setUserRole('worker');
            setWorkerPermissions(result.permissions);
            setWorkerCode(code.toUpperCase());
            setWorkerName(result.savedName || name);
            setCurrentUser(result.ownerPhone);
            const assignedGens = result.assignedGenerators || [];
            setWorkerAssignedGenerators(assignedGens);
            await saveToFile('current_user', {
              phone: result.ownerPhone,
              role: 'worker',
              workerCode: code.toUpperCase(),
              workerName: result.savedName || name,
              permissions: result.permissions,
              assignedGeneratorId: result.assignedGeneratorId || null,
              assignedGenerators: assignedGens,
            });
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
              setMonthlyExpenses(targetGen.monthlyExpenses || {});
            }
            setScreen('workerMain');
          }
          return result;
        }}
      />
    );
  }

  if (screen === 'workerMain' && userRole === 'worker') {
    return (
      <View style={styles.mainContainer}>
        <LoadingOverlay visible={!!globalLoading} text={globalLoading} />
        <WorkerMainScreen
          generatorName={generatorName}
          onShowSubscribers={() => setSubscribersVisible(true)}
          onShowReports={() => setReportsVisible(true)}
          subscribers={subscribers}
          amperPrices={amperPrices}
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
        />
        <SubscribersScreen
          visible={subscribersVisible}
          onClose={() => setSubscribersVisible(false)}
          subscribers={subscribers}
          onSaveSubscriber={handleAddSubscriber}
          onDeleteSubscriber={handleDeleteSubscriber}
          onTogglePaid={handleTogglePaid}
          onPartialPayment={handlePartialPayment}
          onRestoreSubscriber={handleRestoreSubscriber}
          onChangeAmper={handleChangeAmper}
          amperPrices={amperPrices}
          onSaveAmperPrice={saveAmperPrice}
          currentUser={currentUser}
          ownerName={ownerName}
          userRole={userRole}
          workerPermissions={workerPermissions}
        />
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
                      setMonthlyExpenses(freshGen.monthlyExpenses || {});
                      setWorkerAssignedGeneratorId(freshGen.id);
                    } catch (e) {
                      setGenerators(generators);
                      setCurrentGeneratorId(gen.id);
                      setGeneratorName(gen.name);
                      setSubscribers(gen.subscribers || []);
                      setAmperPrices(gen.amperPrices || {});
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

  if (userRole === 'worker') {
    return (
      <View style={styles.mainContainer}>
        <WorkerMainScreen
          generatorName={generatorName}
          onShowSubscribers={() => setSubscribersVisible(true)}
          onShowReports={() => setReportsVisible(true)}
          subscribers={subscribers}
          amperPrices={amperPrices}
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
        />
        <SubscribersScreen
          visible={subscribersVisible}
          onClose={() => setSubscribersVisible(false)}
          subscribers={subscribers}
          onSaveSubscriber={handleAddSubscriber}
          onDeleteSubscriber={handleDeleteSubscriber}
          onTogglePaid={handleTogglePaid}
          onPartialPayment={handlePartialPayment}
          onRestoreSubscriber={handleRestoreSubscriber}
          onChangeAmper={handleChangeAmper}
          amperPrices={amperPrices}
          onSaveAmperPrice={saveAmperPrice}
          currentUser={currentUser}
          ownerName={ownerName}
          userRole={userRole}
          workerPermissions={workerPermissions}
        />
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
                      setMonthlyExpenses(freshGen.monthlyExpenses || {});
                      setWorkerAssignedGeneratorId(freshGen.id);
                    } catch (e) {
                      setGenerators(generators);
                      setCurrentGeneratorId(gen.id);
                      setGeneratorName(gen.name);
                      setSubscribers(gen.subscribers || []);
                      setAmperPrices(gen.amperPrices || {});
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

  return (
    <View style={styles.mainContainer}>
      <LoadingOverlay visible={!!globalLoading} text={globalLoading} />
      <MainScreen
        currentUser={currentUser}
        generatorName={generatorName}
        onOpenSettings={() => setSettingsVisible(true)}
        onShowSubscribers={() => setSubscribersVisible(true)}
        onShowReports={() => setReportsVisible(true)}
        subscribers={subscribers}
        amperPrices={amperPrices}
        onSetAmperPrice={saveAmperPrice}
        expenses={expenses}
        onSetExpenses={saveExpenses}
        onLogout={handleLogout}
        isOnline={isOnline}
        generators={generators}
        onAddGenerator={() => setAddGeneratorVisible(true)}
        onSwitchGenerator={() => setSwitchGeneratorVisible(true)}
        onShowMonthlyData={() => setMonthlyDataVisible(true)}
        darkMode={darkMode}
        pendingUpdatesCount={pendingWorkerUpdates.length}
        onShowWorkerTracking={() => setWorkerTrackingVisible(true)}
        workers={workers}
      />
      <SettingsScreen
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        generatorName={generatorName}
        onSaveGeneratorName={saveGeneratorName}
        ownerName={ownerName}
        onSaveOwnerName={saveOwnerName}
        onExport={handleExport}
        onImport={handleImport}
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
      />
      <WorkerUpdatesModal
        visible={updatesModalVisible}
        onClose={() => setUpdatesModalVisible(false)}
        batches={pendingWorkerUpdates}
        onApplyBatch={handleApplyBatch}
        onDeleteBatch={handleDeleteBatch}
        amperPrices={amperPrices}
        rejectedBatches={workerActivityLog.filter(b => b.status === 'rejected')}
        onReapplyBatch={handleReapplyBatch}
      />
      <WorkerTrackingScreen
        visible={workerTrackingVisible}
        onClose={() => setWorkerTrackingVisible(false)}
        workers={workers}
        activityLog={workerActivityLog}
        amperPrices={amperPrices}
      />
      <SubscribersScreen
        visible={subscribersVisible}
        onClose={() => setSubscribersVisible(false)}
        subscribers={subscribers}
        onSaveSubscriber={handleAddSubscriber}
        onDeleteSubscriber={handleDeleteSubscriber}
        onTogglePaid={handleTogglePaid}
        onPartialPayment={handlePartialPayment}
        onRestoreSubscriber={handleRestoreSubscriber}
        onChangeAmper={handleChangeAmper}
        amperPrices={amperPrices}
        onSaveAmperPrice={saveAmperPrice}
        currentUser={currentUser}
        ownerName={ownerName}
        userRole={userRole}
        workerPermissions={workerPermissions}
      />
      <ReportsScreen
        visible={reportsVisible}
        onClose={() => setReportsVisible(false)}
        subscribers={subscribers}
        amperPrices={amperPrices}
      />
      <MonthlyDataScreen
        visible={monthlyDataVisible}
        onClose={() => setMonthlyDataVisible(false)}
        subscribers={subscribers}
        amperPrices={amperPrices}
        monthlyExpenses={monthlyExpenses}
      />
      {addGeneratorVisible && (
        <Modal visible={addGeneratorVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.partialModalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setAddGeneratorVisible(false)}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>إضافة مولد جديد</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 16, color: '#333', marginBottom: 10, textAlign: 'right' }}>ادخل اسم المولد الجديد</Text>
                <AddGeneratorInput
                  onAdd={(name) => {
                    handleCreateGenerator(name);
                    setAddGeneratorVisible(false);
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
      {switchGeneratorVisible && (
        <Modal visible={switchGeneratorVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.partialModalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setSwitchGeneratorVisible(false)}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>تبديل المولد</Text>
                <View style={{ width: 28 }} />
              </View>
              <ScrollView style={{ maxHeight: 400 }}>
                {generators.map(gen => (
                  <TouchableOpacity
                    key={gen.id}
                    style={{
                      padding: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: '#eee',
                      flexDirection: 'row-reverse',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: gen.id === currentGeneratorId ? '#E3F2FD' : 'white',
                    }}
                    onPress={() => {
                      handleSwitchGenerator(gen.id);
                      setSwitchGeneratorVisible(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="flash" size={24} color={gen.id === currentGeneratorId ? '#2196F3' : '#999'} />
                      <Text style={{ fontSize: 16, color: '#333', fontWeight: gen.id === currentGeneratorId ? 'bold' : 'normal' }}>{gen.name}</Text>
                    </View>
                    {gen.id === currentGeneratorId && (
                      <Ionicons name="checkmark-circle" size={24} color="#2196F3" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
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
    paddingHorizontal: 30,
    maxWidth: IS_TABLET ? 500 : '100%',
    alignSelf: 'center',
    width: '100%',
  },
  welcomeLogo: {
    alignItems: 'center',
    marginBottom: 60,
  },
  welcomeTitle: {
    fontSize: 42,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 16,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 8,
  },
  welcomeLoginBtn: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  welcomeLoginText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  welcomeRegisterBtn: {
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    width: '100%',
  },
  welcomeRegisterText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },

  loginContainer: {
    flex: 1,
    backgroundColor: '#1565C0',
  },
  loginScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 30,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingBottom: 40,
    maxWidth: IS_TABLET ? 500 : '100%',
    alignSelf: 'center',
    width: '100%',
  },
  loginContent: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    maxWidth: IS_TABLET ? 500 : '100%',
    alignSelf: 'center',
    width: '100%',
  },
  backBtn: {
    alignSelf: 'flex-end',
    padding: 8,
    marginBottom: 10,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  appTitle: {
    fontSize: IS_SMALL ? 24 : 32,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 12,
  },
  loginCard: {
    backgroundColor: 'white',
    borderRadius: 20,
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
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: IS_SMALL ? 12 : 16,
    fontSize: IS_SMALL ? 14 : 16,
    color: '#333',
  },
  loginButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    paddingVertical: IS_SMALL ? 12 : 16,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  loginButtonText: {
    color: 'white',
    fontSize: IS_SMALL ? 15 : 18,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#2196F3',
    fontSize: 14,
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
    paddingBottom: 15,
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
    gap: 10,
    marginTop: 16,
  },
  addButton: {
    borderWidth: 1.5,
    borderColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addButtonText: {
    color: '#2196F3',
    fontSize: 15,
    fontWeight: '600',
  },
  monthlyDataButton: {
    backgroundColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  monthlyDataButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  dateContainer: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  dateText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  priceSection: {
    marginTop: 16,
  },
  priceLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    textAlign: 'right',
  },
  priceInput: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 20,
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
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
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
    fontSize: IS_SMALL ? 14 : 17,
    fontWeight: '700',
    color: '#333',
  },
  summaryValue: {
    fontSize: IS_SMALL ? 14 : 17,
    fontWeight: '700',
    color: '#333',
  },
  collectedValue: {
    color: '#4CAF50',
  },
  expensesSection: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  expensesHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  expensesTitle: {
    fontSize: IS_SMALL ? 15 : 18,
    fontWeight: '700',
    color: '#333',
  },
  expenseRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  expenseAddButton: {
    padding: 4,
  },
  expenseLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: IS_SMALL ? 75 : 90,
  },
  expenseLabel: {
    fontSize: IS_SMALL ? 12 : 15,
    fontWeight: '600',
    color: '#555',
  },
  expenseInput: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: IS_SMALL ? 10 : 14,
    fontSize: IS_SMALL ? 14 : 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginHorizontal: 10,
    textAlign: 'center',
  },
  netExpectedContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
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
    fontSize: IS_SMALL ? 14 : 17,
    fontWeight: '700',
    color: '#333',
  },
  netExpectedValue: {
    fontSize: IS_SMALL ? 14 : 17,
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
});
