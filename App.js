import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';

const API_BASE = 'https://generator-billing-api-production.up.railway.app';

async function apiCall(method, path, body) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${API_BASE}${path}`, options);
    return await response.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function saveToFile(filename, data) {
  await apiCall('PUT', `/api/data/${filename}`, { data });
}

async function loadFromFile(filename) {
  const result = await apiCall('GET', `/api/data/${filename}`);
  return result.success ? result.data : null;
}

async function deleteFile(filename) {
  await apiCall('DELETE', `/api/data/${filename}`);
}

const saveQueues = {};

async function saveUserData(phone, key, data) {
  const filename = phone + '_data';
  if (!saveQueues[filename]) saveQueues[filename] = Promise.resolve();
  saveQueues[filename] = saveQueues[filename].then(async () => {
    const allData = await loadFromFile(filename) || {};
    allData[key] = data;
    await saveToFile(filename, allData);
  });
  return saveQueues[filename];
}

async function loadUserData(phone, key) {
  const allData = await loadFromFile(phone + '_data');
  if (!allData) return null;
  return allData[key] !== undefined ? allData[key] : null;
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

async function hashPassword(password) {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    password.trim()
  );
}

function getSecureRandom(max) {
  const arr = new Uint8Array(1);
  Crypto.getRandomValues(arr);
  return arr[0] % max;
}

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
  const allData = await loadFromFile(phone + '_data');
  if (!allData || Object.keys(allData).length === 0) {
    return null;
  }
  const exportObj = {
    appVersion: '1.0.0',
    exportDate: new Date().toISOString(),
    phone: phone,
    data: allData,
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
    if (!importObj.phone || !importObj.data) {
      return { success: false, error: 'ملف غير صالح' };
    }
    await saveToFile(importObj.phone + '_data', importObj.data);
    return { success: true, phone: importObj.phone };
  } catch (e) {
    return { success: false, error: 'خطأ في قراءة الملف' };
  }
}

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

const RegisterScreen = ({ onBack, onRegister }) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = async () => {
    const phoneError = validatePhone(phone);
    if (phoneError) {
      Alert.alert('تنبيه', phoneError);
      return;
    }
    if (!password.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال كلمة المرور');
      return;
    }
    if (password.length < 4) {
      Alert.alert('تنبيه', 'كلمة المرور يجب أن تكون 4 أحرف على الأقل');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('تنبيه', 'كلمتا المرور غير متطابقتين');
      return;
    }

    const hashedPassword = await hashPassword(password);
    const result = await apiCall('POST', '/api/register', { phone: phone.trim(), password: hashedPassword });
    if (!result.success) {
      Alert.alert('تنبيه', result.error || 'خطأ في التسجيل');
      return;
    }

    await saveUserData(phone.trim(), 'generatorName', '');
    await saveUserData(phone.trim(), 'amperPrices', {});
    await saveUserData(phone.trim(), 'subscribers', []);
    await saveUserData(phone.trim(), 'expenses', { gas: '0', oil: '0', repairs: '0', salaries: '0' });

    Alert.alert('تم', 'تم إنشاء الحساب بنجاح', [
      { text: 'موافق', onPress: onBack }
    ]);
  };

  return (
    <View style={styles.loginContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
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
            <Ionicons name="lock-closed-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="كلمة المرور"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={22} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={22} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="تأكيد كلمة المرور"
              placeholderTextColor="#999"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
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

const LoginScreen = ({ onBack, onRegister, onLogin }) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(null);

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

    const result = await apiCall('POST', '/api/login', { phone: phone.trim() });
    if (!result.success) {
      Alert.alert('تنبيه', 'خطأ في الاتصال بالخادم');
      return;
    }
    const user = result.user;
    if (!user) {
      Alert.alert('تنبيه', 'الرقم غير مسجل');
      return;
    }

    const hashedPassword = await hashPassword(password);
    let authenticated = false;
    let migrated = false;

    const stored = user.password_hash;
    if (stored === hashedPassword) {
      authenticated = true;
    } else if (stored.length !== 64 && stored === password.trim()) {
      authenticated = true;
      migrated = true;
    }

    if (migrated) {
      await apiCall('PUT', '/api/password', { phone: phone.trim(), password: hashedPassword });
    }

    if (!authenticated) {
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
    await saveToFile('current_user', { phone: phone.trim() });
    onLogin(phone.trim());
  };

  return (
    <View style={styles.loginContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
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
        </View>
      </View>
    </View>
  );
};

const WorkerLoginScreen = ({ onBack, onLogin }) => {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');

  const handleLogin = async () => {
    if (!code.trim() || !pin.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال الكود والرمز السري');
      return;
    }
    const result = await onLogin(code.trim(), pin.trim());
    if (!result.success) {
      Alert.alert('تنبيه', 'الكود أو الرمز السري غير صحيح');
    }
  };

  return (
    <View style={styles.loginContainer}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
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
        </View>
      </View>
    </View>
  );
};

const SettingsScreen = ({ visible, onClose, generatorName, onSaveGeneratorName, ownerName, onSaveOwnerName, onExport, onImport, onCreateWorker, pendingWorkerUpdates, onLoadUpdates, onApplyUpdates }) => {
  const [name, setName] = useState(generatorName);
  const [owner, setOwner] = useState(ownerName);
  const [workerModalVisible, setWorkerModalVisible] = useState(false);
  const [workerPermissions, setWorkerPermissions] = useState([]);

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
    onCreateWorker(workerPermissions);
    setWorkerPermissions([]);
    setWorkerModalVisible(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>الإعدادات</Text>
            <TouchableOpacity onPress={() => { onSaveGeneratorName(name); onSaveOwnerName(owner); onClose(); }}>
              <Text style={styles.saveButtonText}>تم</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.settingsBody}>
              <Text style={styles.settingsLabel}>اسم المولد</Text>
              <TextInput
                style={styles.settingsInput}
                value={name}
                onChangeText={handleSaveName}
                placeholder="أدخل اسم المولد"
                placeholderTextColor="#999"
                textAlign="right"
              />
              <Text style={styles.settingsHint}>سيتم عرض هذا الاسم في مكان عنوان التطبيق</Text>

              <View style={styles.settingsDivider} />

              <Text style={styles.settingsLabel}>اسم صاحب المولد</Text>
              <TextInput
                style={styles.settingsInput}
                value={owner}
                onChangeText={handleSaveOwner}
                placeholder="أدخل اسم صاحب المولد"
                placeholderTextColor="#999"
                textAlign="right"
              />
              <Text style={styles.settingsHint}>سيتم عرض هذا الاسم عند كل عملية دفع أو إلغاء دفع</Text>

              <View style={styles.settingsDivider} />

              <Text style={styles.settingsLabel}>النسخ الاحتياطي</Text>
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
              <Text style={styles.settingsHint}>تصدير: حفظ نسخة احتياطية ومشاركتها عبر واتساب أو إيميل</Text>
              <Text style={styles.settingsHint}>استيراد: استعادة بيانات من نسخة احتياطية سابقة</Text>

              <View style={styles.settingsDivider} />

              <Text style={styles.settingsLabel}>إدارة العمال</Text>
              <TouchableOpacity style={[styles.settingsInput, { backgroundColor: '#FF9800', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]} onPress={() => setWorkerModalVisible(true)}>
                <Ionicons name="person-add-outline" size={20} color="white" />
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>إضافة عامل</Text>
              </TouchableOpacity>
              <Text style={styles.settingsHint}>إنشاء كود ورمز سري جديد للعامل</Text>

              {pendingWorkerUpdates.length > 0 && (
                <View style={{ marginTop: 15 }}>
                  <TouchableOpacity
                    style={[styles.settingsInput, { backgroundColor: '#F44336', borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}
                    onPress={async () => { await onLoadUpdates(); setUpdatesModalVisible(true); }}
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
            </View>
          </ScrollView>
        </View>
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

            <TouchableOpacity style={[styles.modalButton, { backgroundColor: '#FF9800', marginTop: 20 }]} onPress={handleConfirmCreateWorker}>
              <Text style={styles.modalButtonText}>إنشاء حساب العامل</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const WorkerUpdatesModal = ({ visible, onClose, updates, onApplyUpdates, amperPrices }) => {
  const [categoryVisible, setCategoryVisible] = useState(false);
  const [categoryType, setCategoryType] = useState(null);

  const paidUpdates = updates.filter(u => u.type === 'paid');
  const cancelledUpdates = updates.filter(u => u.type === 'cancelled');
  const deletedUpdates = updates.filter(u => u.type === 'delete');
  const partialUpdates = updates.filter(u => u.type === 'partialPayment');
  const editUpdates = updates.filter(u => u.type === 'edit' || u.type === 'restore');

  const paidTotal = paidUpdates.reduce((sum, u) => sum + (u.details && u.details.amount ? parseFloat(u.details.amount) : 0), 0);
  const partialTotal = partialUpdates.reduce((sum, u) => sum + (u.details && u.details.amount ? parseFloat(u.details.amount) : 0), 0);
  const partialRemaining = partialUpdates.reduce((sum, u) => {
    const monthPrice = getAmperPrice(amperPrices, u.monthKey);
    const totalDue = (u.amper || 0) * monthPrice;
    const paid = u.details && u.details.amount ? parseFloat(u.details.amount) : 0;
    return sum + Math.max(0, totalDue - paid);
  }, 0);

  const categories = [
    { type: 'paid', icon: 'checkmark-circle', label: 'مدفوع', count: paidUpdates.length, color: '#4CAF50', total: paidTotal },
    { type: 'cancelled', icon: 'close-circle', label: 'تم الغاء دفعه', count: cancelledUpdates.length, color: '#FF5722', total: 0 },
    { type: 'delete', icon: 'trash', label: 'محذوف', count: deletedUpdates.length, color: '#F44336', total: 0, isAmper: true },
    { type: 'partialPayment', icon: 'wallet', label: 'دفع جزئي', count: partialUpdates.length, color: '#FF9800', total: partialTotal, extra: partialRemaining },
    { type: 'edit', icon: 'create', label: 'تعديلات', count: editUpdates.length, color: '#2196F3', total: 0 },
  ];

  const getUpdatesByType = (type) => {
    switch (type) {
      case 'paid': return paidUpdates;
      case 'cancelled': return cancelledUpdates;
      case 'delete': return deletedUpdates;
      case 'partialPayment': return partialUpdates;
      case 'edit': return editUpdates;
      default: return [];
    }
  };

  const categoryLabels = {
    paid: 'المدفوعين',
    cancelled: 'تم الغاء دفعهم',
    delete: 'المحذوفين',
    partialPayment: 'الدفعات الجزئية',
    edit: 'التعديلات',
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>تحديثات العامل</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ padding: 15 }}>
              {(paidTotal + partialTotal) > 0 && (
                <View style={{ backgroundColor: '#E8F5E9', borderRadius: 12, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#4CAF50', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: '#4CAF50', fontWeight: 'bold' }}>المجموع الكلي</Text>
                  <Text style={{ fontSize: 22, color: '#2E7D32', fontWeight: 'bold', marginTop: 5 }}>{formatNumber(paidTotal + partialTotal)} د.ع</Text>
                  <Text style={{ fontSize: 12, color: '#666', marginTop: 5 }}>مدفوع: {formatNumber(paidTotal)} | دفع جزئي: {formatNumber(partialTotal)}</Text>
                </View>
              )}
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.type}
                  style={{ flexDirection: 'row-reverse', alignItems: 'center', padding: 15, marginBottom: 10, backgroundColor: '#f8f8f8', borderRadius: 12, gap: 12 }}
                  onPress={() => { setCategoryType(cat.type); setCategoryVisible(true); }}
                >
                  <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: cat.color + '20', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={cat.icon} size={28} color={cat.color} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>{cat.label}</Text>
                    <Text style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{cat.count} حالة</Text>
                    {cat.count > 0 && cat.total > 0 && (
                      <Text style={{ fontSize: 13, color: cat.color, fontWeight: 'bold', marginTop: 2 }}>
                        {cat.isAmper ? `المجموع: ${formatNumber(cat.total)} أميبر` : `المجموع: ${formatNumber(cat.total)} د.ع`}
                      </Text>
                    )}
                    {cat.count > 0 && cat.extra > 0 && (
                      <Text style={{ fontSize: 12, color: '#F44336', fontWeight: 'bold', marginTop: 2 }}>
                        المتبقي: {formatNumber(cat.extra)} د.ع
                      </Text>
                    )}
                  </View>
                  {cat.count > 0 && (
                    <View style={{ backgroundColor: cat.color, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{cat.count}</Text>
                    </View>
                  )}
                  <Ionicons name="chevron-back" size={22} color="#999" />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.modalButton, { backgroundColor: '#4CAF50', marginTop: 10 }]}
            onPress={onApplyUpdates}
          >
            <Text style={styles.modalButtonText}>تطبيق جميع التحديثات</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={categoryVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setCategoryVisible(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{categoryLabels[categoryType] || ''}</Text>
              <View style={{ width: 28 }} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={{ padding: 15 }}>
                {getUpdatesByType(categoryType).length === 0 ? (
                  <Text style={{ textAlign: 'center', color: '#999', fontSize: 16, marginTop: 40 }}>لا يوجد تحديثات</Text>
                ) : (
                  getUpdatesByType(categoryType).map((update, index) => (
                    <View key={update.id || index} style={{ backgroundColor: '#f8f8f8', borderRadius: 12, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#eee' }}>
                      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>{update.subscriberName}</Text>
                        {update.amper && <Text style={{ fontSize: 14, color: '#FF9800', fontWeight: 'bold' }}>{update.amper} أميبر</Text>}
                      </View>
                      {update.monthKey && (
                        <Text style={{ fontSize: 13, color: '#666', marginTop: 5 }}>شهر: {update.monthKey.split('_')[0]}/{update.monthKey.split('_')[1]}</Text>
                      )}
                      {update.details && update.details.amount && (
                        <Text style={{ fontSize: 14, color: '#4CAF50', fontWeight: 'bold', marginTop: 5 }}>المبلغ: {formatNumber(update.details.amount)} د.ع</Text>
                      )}
                      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 }}>
                        <Text style={{ fontSize: 12, color: '#999' }}>{update.timestamp}</Text>
                        <Text style={{ fontSize: 12, color: '#FF9800', fontWeight: 'bold' }}>{update.ownerName}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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

const AddSubscriberModal = ({ visible, onClose, onSave, selectedMonth, selectedYear }) => {
  const [name, setName] = useState('');
  const [amper, setAmper] = useState('');
  const [subscriberNumber, setSubscriberNumber] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [visaNumber, setVisaNumber] = useState('');

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
    onClose();
  };

  if (!visible) return null;

  return (
    <View style={styles.addSubscriberOverlay}>
      <View style={styles.addSubscriberModalContent}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color="#333" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>إضافة مشترك</Text>
          <View style={{ width: 30 }} />
        </View>
        <ScrollView style={styles.addSubscriberBody} showsVerticalScrollIndicator={false}>
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
          <TouchableOpacity style={styles.saveSubscriberButton} onPress={handleSave}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.saveSubscriberText}>حفظ المشترك</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  );
};

const EditSubscriberModal = ({ visible, onClose, subscriber, onSave, selectedMonth, selectedYear, isPaid }) => {
  const [name, setName] = useState('');
  const [amper, setAmper] = useState('');
  const [subscriberNumber, setSubscriberNumber] = useState('');
  const [meterNumber, setMeterNumber] = useState('');
  const [visaNumber, setVisaNumber] = useState('');

  useEffect(() => {
    if (subscriber) {
      setName(subscriber.name || '');
      setAmper(String(subscriber.amper || ''));
      setSubscriberNumber(subscriber.subscriberNumber || '');
      setMeterNumber(subscriber.meterNumber || '');
      setVisaNumber(subscriber.visaNumber || '');
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
    };
    if (!isPaid && amperVal !== subscriber.amper) {
      updatedSubscriber.amper = amperVal;
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
    <View style={styles.addSubscriberOverlay}>
      <View style={styles.addSubscriberModalContent}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color="#333" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>تعديل المشترك</Text>
          <View style={{ width: 30 }} />
        </View>
        <ScrollView style={styles.addSubscriberBody} showsVerticalScrollIndicator={false}>
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
          <TouchableOpacity style={styles.saveSubscriberButton} onPress={handleSave}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.saveSubscriberText}>حفظ التعديلات</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
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
              Alert.alert('خطأ', 'المبلغ المدخل أكبر من المتبقي');
              return;
            }
            onConfirm(parsed);
            setAmount('');
            onClose();
          }}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.partialConfirmText}>تأكيد الدفع</Text>
          </TouchableOpacity>

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
    if (!parsed || parsed <= 0) {
      Alert.alert('خطأ', 'أدخل عدد أمبير صحيح');
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
      <MonthPickerModal visible={monthPickerVisible} onClose={() => setMonthPickerVisible(false)} onSelect={setChangeMonth} selectedMonth={changeMonth} />
      <YearPickerModal visible={yearPickerVisible} onClose={() => setYearPickerVisible(false)} onSelect={setChangeYear} selectedYear={changeYear} />
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

  const visibleSubscribers = subscribers.filter(sub => {
    return isVisibleForMonth(sub, parseInt(selectedMonth), parseInt(selectedYear));
  });

  const deletedForMonth = subscribers.filter(sub => {
    return isDeletedForReport(sub, selectedMonth, selectedYear);
  });

  const hasPartialPayments = (sub) => {
    const pp = sub.partialPayments && sub.partialPayments[monthKey];
    return pp && pp.length > 0;
  };

  const visibleCount = visibleSubscribers.length;
  const paidCount = visibleSubscribers.filter(s => isPaid(s)).length;
  const requiredCount = visibleSubscribers.filter(s => !isPaid(s) && hasPartialPayments(s)).length;
  const unpaidCount = visibleSubscribers.filter(s => !isPaid(s) && !hasPartialPayments(s)).length;

  const filters = [
    { id: 'total', label: 'الإجمالي اشتراك', count: visibleCount },
    { id: 'required', label: 'المطلوبين', count: requiredCount },
    { id: 'unpaid', label: 'غير مدفوع', count: unpaidCount },
    { id: 'paid', label: 'مدفوع', count: paidCount },
    { id: 'deleted', label: 'المحذوفين', count: deletedForMonth.length },
    { id: 'all', label: 'الكل', count: visibleCount },
  ];

  const filteredSubscribers = visibleSubscribers.filter(sub => {
    const matchesSearch = sub.name.includes(searchText) ||
      (sub.subscriberNumber && sub.subscriberNumber.includes(searchText)) ||
      (sub.meterNumber && sub.meterNumber.includes(searchText));

    if (activeFilter === 'paid') return matchesSearch && isPaid(sub);
    if (activeFilter === 'unpaid') return matchesSearch && !isPaid(sub) && !hasPartialPayments(sub);
    if (activeFilter === 'required') return matchesSearch && !isPaid(sub) && hasPartialPayments(sub);
    return matchesSearch;
  });

  const paginatedSubscribers = filteredSubscribers.slice(0, displayCount);
  const hasMore = filteredSubscribers.length > displayCount;

  const filteredDeleted = deletedForMonth.filter(sub => {
    return sub.name.includes(searchText) ||
      (sub.subscriberNumber && sub.subscriberNumber.includes(searchText)) ||
      (sub.meterNumber && sub.meterNumber.includes(searchText));
  });

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
                  placeholderTextColor="transparent"
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
              <TouchableOpacity style={[styles.addSubscriberButtonHalf, { backgroundColor: '#FF9800' }]} onPress={() => {
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
                  </View>
                  {canEdit && (
                    <TouchableOpacity style={styles.restoreButton} onPress={() => onRestoreSubscriber(subscriber.id)}>
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
                      <TouchableOpacity style={styles.payCheckbox} onPress={() => {
                        setExpandedCard(null);
                        if (!price || price === 0) {
                          Alert.alert('تحديد السعر', 'لم يتم تحديد سعر الأمبير لهذا الشهر بعد');
                          return;
                        }
                        if (isFullyPaid) {
                          Alert.alert('إلغاء التسديد', `هل تريد إلغاء تسديد اشتراك "${subscriber.name}"؟`, [
                            { text: 'إلغاء', style: 'cancel' },
                            { text: 'نعم', onPress: () => onTogglePaid(subscriber.id, monthKey) },
                          ]);
                        } else {
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
                      <View style={styles.cardNameSection}>
                          <Text style={styles.subscriberName}>{subscriber.name}</Text>
                        {!isFullyPaid && (
                            <Text style={styles.subscriberAmperTag}>{currentAmper} أميبر</Text>
                        )}
                      </View>
                      <View style={styles.cardPriceSection}>
                        <Text style={styles.cardPrice}>د.ع {formatNumber(totalDue)}</Text>
                        {!isFullyPaid && (
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
                  style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
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
                  style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
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

  const filteredSubscribers = subscribers.filter(sub => {
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

  const monthsToShow = selectedMonth === 'all' ? months : [selectedMonth];

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
  const totalRemaining = totalDue - totalPaid;

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
                    <Text style={styles.reportSummaryValue}>د.ع {formatNumber(totalDue)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>المدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryPaid]}>د.ع {formatNumber(totalPaid)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>الغير مدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryRemaining]}>د.ع {formatNumber(totalRemaining)}</Text>
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

const MainScreen = ({ currentUser, generatorName, onOpenSettings, onShowSubscribers, onShowReports, subscribers, amperPrices, onSetAmperPrice, expenses, onSetExpenses, onLogout, isOnline }) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;

  const [localAmperPrice, setLocalAmperPrice] = useState(String(amperPrices[currentMonthKey] || '0'));
  const [gas, setGas] = useState(expenses.gas);
  const [oil, setOil] = useState(expenses.oil);
  const [repairs, setRepairs] = useState(expenses.repairs);
  const [salaries, setSalaries] = useState(expenses.salaries);
  const [addExpenseVisible, setAddExpenseVisible] = useState(false);
  const [addExpenseField, setAddExpenseField] = useState(null);
  const [addExpenseAmount, setAddExpenseAmount] = useState('');
  const [addExpenseLabel, setAddExpenseLabel] = useState('');

  useEffect(() => {
    setLocalAmperPrice(String(amperPrices[currentMonthKey] || '0'));
    setGas(expenses.gas);
    setOil(expenses.oil);
    setRepairs(expenses.repairs);
    setSalaries(expenses.salaries);
  }, [amperPrices, expenses]);

  const totalSubscribers = subscribers.length;
  let totalAmper = 0;
  let paidCount = 0;
  let requiredCount = 0;
  let unpaidCount = 0;
  let collectedAmount = 0;
  const price = parseFloat(localAmperPrice) || 0;

  subscribers.forEach(s => {
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
      const ppSum = pp.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      collectedAmount += ppSum;
    } else {
      unpaidCount++;
    }
  });

  const expectedAmount = totalAmper * price;

  const totalExpenses = (parseFloat(gas) || 0) + (parseFloat(oil) || 0) +
    (parseFloat(repairs) || 0) + (parseFloat(salaries) || 0);
  const netExpected = collectedAmount - totalExpenses;

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
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor={isOnline ? "#2196F3" : "#FF5722"} barStyle="light-content" />
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="white" />
          <Text style={styles.offlineBannerText}>وضع عدم الاتصال - البيانات محفوظة محلياً</Text>
        </View>
      )}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.menuButton} onPress={onOpenSettings}>
            <Ionicons name="settings-outline" size={26} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Ionicons name="log-out-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{generatorName || 'نظام الجباية'}</Text>
        <TouchableOpacity style={styles.detailsButton}>
          <Ionicons name="document-text-outline" size={18} color="white" />
          <Text style={styles.detailsButtonText}>تفاصيل المولد</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.addButton}>
            <Text style={styles.addButtonText}>إضافة مولد</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.monthlyDataButton}>
            <Text style={styles.monthlyDataButtonText}>بيانات كل شهر</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dateContainer}>
          <Text style={styles.dateText}>{getCurrentDate()}</Text>
        </View>

        <View style={styles.priceSection}>
          <Text style={styles.priceLabel}>سعر الأميبر - شهر {currentMonth} (د.ع)</Text>
          <TextInput style={styles.priceInput} value={localAmperPrice ? formatNumber(localAmperPrice) : ''} onChangeText={handleAmperPriceChange} keyboardType="numeric" textAlign="center" placeholder="0" placeholderTextColor="transparent" />
        </View>

        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.totalCard]}>
            <Text style={[styles.statNumber, styles.totalNumber]} numberOfLines={1} adjustsFontSizeToFit>{totalSubscribers}</Text>
            <Text style={[styles.statLabel, styles.totalLabel]} numberOfLines={1} adjustsFontSizeToFit>عدد المشتركين</Text>
          </View>
          <View style={[styles.statCard, styles.amperCard]}>
            <Text style={[styles.statNumber, styles.amperNumber]} numberOfLines={1} adjustsFontSizeToFit>{totalAmper}</Text>
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

        <View style={styles.financialSummary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>المتوقع:</Text>
            <Text style={styles.summaryValue}>د.ع {formatNumber(expectedAmount)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>المحصّل:</Text>
            <Text style={[styles.summaryValue, styles.collectedValue]}>د.ع {formatNumber(collectedAmount)}</Text>
          </View>
        </View>

        <View style={styles.expensesSection}>
          <View style={styles.expensesHeader}>
            <Ionicons name="wallet-outline" size={24} color="#4CAF50" />
            <Text style={styles.expensesTitle}>الصرفيات</Text>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('gas', 'كاز')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={styles.expenseInput} value={gas ? formatNumber(gas) : ''} onChangeText={(v) => handleExpenseChange('gas', onlyDigits(v))} keyboardType="numeric" placeholderTextColor="transparent" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="water" size={16} color="#2196F3" />
              <Text style={styles.expenseLabel}>كاز</Text>
            </View>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('oil', 'دهن')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={styles.expenseInput} value={oil ? formatNumber(oil) : ''} onChangeText={(v) => handleExpenseChange('oil', onlyDigits(v))} keyboardType="numeric" placeholderTextColor="transparent" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="flask" size={16} color="#9C27B0" />
              <Text style={styles.expenseLabel}>دهن</Text>
            </View>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('repairs', 'إصلاحات')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={styles.expenseInput} value={repairs ? formatNumber(repairs) : ''} onChangeText={(v) => handleExpenseChange('repairs', onlyDigits(v))} keyboardType="numeric" placeholderTextColor="transparent" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="build" size={16} color="#FF5722" />
              <Text style={styles.expenseLabel}>إصلاحات</Text>
            </View>
          </View>
          <View style={styles.expenseRow}>
            <TouchableOpacity style={styles.expenseAddButton} onPress={() => openAddExpense('salaries', 'رواتب')}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TextInput style={styles.expenseInput} value={salaries ? formatNumber(salaries) : ''} onChangeText={(v) => handleExpenseChange('salaries', onlyDigits(v))} keyboardType="numeric" placeholderTextColor="transparent" />
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="people" size={16} color="#607D8B" />
              <Text style={styles.expenseLabel}>رواتب</Text>
            </View>
          </View>
        </View>

        <View style={[styles.netExpectedContainer, netExpected < 0 && styles.netExpectedNegative]}>
          <Text style={styles.netExpectedLabel}>الصافي المتوقع:</Text>
          <Text style={[styles.netExpectedValue, netExpected < 0 && styles.netExpectedValueNegative]}>
            {netExpected < 0 ? `${formatNumber(Math.abs(netExpected))} - د.ع` : `د.ع ${formatNumber(netExpected)}`}
          </Text>
        </View>

        <View style={styles.bottomButtons}>
          <TouchableOpacity style={styles.reportsButton} onPress={onShowReports}>
            <Text style={styles.reportsButtonText}>التقارير</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.showSubscribersButton} onPress={onShowSubscribers}>
            <Ionicons name="people" size={20} color="white" />
            <Text style={styles.showSubscribersText}>عرض المشتركين</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={addExpenseVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
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

const WorkerMainScreen = ({ generatorName, onShowSubscribers, onShowReports, subscribers, amperPrices, onLogout, isOnline, workerUpdates, onSync }) => {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;

  const totalSubscribers = subscribers.length;
  const paidCount = subscribers.filter(s => s.paidMonths && s.paidMonths[currentMonthKey]).length;
  const hasPartialPaymentsWorker = (sub) => {
    const pp = sub.partialPayments && sub.partialPayments[currentMonthKey];
    return pp && pp.length > 0;
  };
  const requiredCount = subscribers.filter(s => !(s.paidMonths && s.paidMonths[currentMonthKey]) && hasPartialPaymentsWorker(s)).length;
  const unpaidCount = subscribers.filter(s => !(s.paidMonths && s.paidMonths[currentMonthKey]) && !hasPartialPaymentsWorker(s)).length;

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor={isOnline ? "#FF9800" : "#FF5722"} barStyle="light-content" />
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="white" />
          <Text style={styles.offlineBannerText}>وضع عدم الاتصال - البيانات محفوظة محلياً</Text>
        </View>
      )}
      <View style={[styles.header, { backgroundColor: '#FF9800' }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Ionicons name="log-out-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{generatorName || 'واجهة العامل'}</Text>
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
          <TouchableOpacity style={styles.showSubscribersButton} onPress={onShowSubscribers}>
            <Ionicons name="people" size={20} color="white" />
            <Text style={styles.showSubscribersText}>عرض المشتركين</Text>
          </TouchableOpacity>
        </View>

        {workerUpdates.length > 0 && (
          <TouchableOpacity style={[styles.showSubscribersButton, { backgroundColor: '#2196F3', marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]} onPress={onSync}>
            <Ionicons name="cloud-upload-outline" size={20} color="white" />
            <Text style={styles.showSubscribersText}>رفع التحديثات ({workerUpdates.length})</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

export default function App() {
  const [screen, setScreen] = useState('welcome');
  const [currentUser, setCurrentUser] = useState(null);
  const [generatorName, setGeneratorName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [subscribersVisible, setSubscribersVisible] = useState(false);
  const [reportsVisible, setReportsVisible] = useState(false);
  const [subscribers, setSubscribers] = useState([]);
  const [amperPrices, setAmperPrices] = useState({});
  const [expenses, setExpenses] = useState({ gas: '0', oil: '0', repairs: '0', salaries: '0' });
  const [userRole, setUserRole] = useState(null);
  const [workerOwnerPhone, setWorkerOwnerPhone] = useState(null);
  const [workerPermissions, setWorkerPermissions] = useState([]);
  const [workerCode, setWorkerCode] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [workerUpdates, setWorkerUpdates] = useState([]);
  const [pendingWorkerUpdates, setPendingWorkerUpdates] = useState([]);
  const [updatesModalVisible, setUpdatesModalVisible] = useState(false);
  const [updateCategoryVisible, setUpdateCategoryVisible] = useState(false);
  const [updateCategoryType, setUpdateCategoryType] = useState(null);
  const lastActivity = React.useRef(Date.now());

  const SESSION_TIMEOUT = 30 * 60 * 1000;

  useEffect(() => {
    checkLoggedIn();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadAllUserData();
    }
  }, [currentUser]);

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

  const resetActivity = () => {
    lastActivity.current = Date.now();
  };

  const checkLoggedIn = async () => {
    const userData = await loadFromFile('current_user');
    if (userData && userData.phone) {
      setCurrentUser(userData.phone);
      setScreen('main');
    }
  };

  const loadAllUserData = async () => {
    if (!currentUser) return;
    const name = await loadUserData(currentUser, 'generatorName');
    const owner = await loadUserData(currentUser, 'ownerName');
    const prices = await loadUserData(currentUser, 'amperPrices');
    const subs = await loadUserData(currentUser, 'subscribers');
    const exp = await loadUserData(currentUser, 'expenses');
    const updates = await loadUserData(currentUser, 'pending_worker_updates');
    if (name !== null) setGeneratorName(name);
    if (owner !== null) setOwnerName(owner);
    if (prices !== null) setAmperPrices(prices);
    if (subs !== null) setSubscribers(subs);
    if (exp !== null) setExpenses(exp);
    if (updates !== null) setPendingWorkerUpdates(updates);
  };

  const handleLogin = (userPhone) => {
    setCurrentUser(userPhone);
    setScreen('main');
  };

  const handleLogout = async () => {
    await deleteFile('current_user');
    setCurrentUser(null);
    setUserRole(null);
    setWorkerOwnerPhone(null);
    setWorkerPermissions([]);
    setWorkerCode('');
    setWorkerUpdates([]);
    setPendingWorkerUpdates([]);
    setGeneratorName('');
    setOwnerName('');
    setAmperPrices({});
    setSubscribers([]);
    setExpenses({ gas: '0', oil: '0', repairs: '0', salaries: '0' });
    setScreen('welcome');
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
      ownerName: workerCode || '',
      details: details || {},
    };
    setWorkerUpdates(prev => [...prev, update]);
  };

  const handleWorkerSync = async () => {
    if (workerUpdates.length === 0) {
      Alert.alert('تنبيه', 'لا توجد تحديثات للرفع');
      return;
    }
    try {
      const existing = await loadUserData(workerOwnerPhone, 'pending_worker_updates') || [];
      const merged = [...existing, ...workerUpdates];
      await saveUserData(workerOwnerPhone, 'pending_worker_updates', merged);
      setWorkerUpdates([]);
      Alert.alert('تم', 'تم رفع التحديثات بنجاح');
    } catch (e) {
      Alert.alert('خطأ', 'فشل رفع التحديثات');
    }
  };

  const handleApplyUpdates = async () => {
    if (pendingWorkerUpdates.length === 0) return;

    let newSubs = [...subscribers];
    for (const update of pendingWorkerUpdates) {
      switch (update.type) {
        case 'add': {
          const exists = newSubs.find(s => s.id === update.subscriberId);
          if (!exists) {
            newSubs.push({
              id: update.subscriberId,
              name: update.subscriberName,
              amper: update.amper,
              phone: update.details.phone || '',
              addedMonth: update.details.addedMonth || new Date().getMonth() + 1,
              addedYear: update.details.addedYear || new Date().getFullYear(),
              paidMonths: {},
              paymentHistory: [],
              partialPayments: {},
              amperHistory: update.details.amperHistory || [],
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
            if (update.type === 'paid') sub.partialPayments[update.monthKey] = [];
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
            if (update.details.amper !== undefined) {
              sub.amper = update.details.amper;
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
      }
    }

    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    await saveUserData(currentUser, 'pending_worker_updates', []);
    setPendingWorkerUpdates([]);
    setUpdatesModalVisible(false);
    Alert.alert('تم', 'تم تطبيق جميع التحديثات بنجاح');
  };

  const loadPendingUpdates = async () => {
    if (!currentUser) return;
    const updates = await loadUserData(currentUser, 'pending_worker_updates');
    setPendingWorkerUpdates(updates || []);
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
    setExpenses(exp);
    if (currentUser) await saveUserData(currentUser, 'expenses', exp);
  };

  const handleCreateWorker = async (permissions) => {
    const code = generateWorkerCode(currentUser);
    const pin = generateWorkerPin();
    const workers = await loadUserData(currentUser, 'workers') || [];
    const newWorker = { code, pin, permissions, createdAt: new Date().toISOString() };
    workers.push(newWorker);
    await saveUserData(currentUser, 'workers', workers);
    Alert.alert(
      'تم إنشاء حساب العامل',
      `كود العامل: ${code}\nالرمز السري: ${pin}\n\nالصلاحيات: ${permissions.join(', ')}`,
      [{ text: 'حسناً' }]
    );
  };

  const handleWorkerLogin = async (code, pin) => {
    const usersResult = await apiCall('GET', '/api/users');
    const list = usersResult.success ? usersResult.users : [];
    for (const user of list) {
      const workers = await loadUserData(user.phone, 'workers');
      if (workers) {
        const found = workers.find(w => w.code === code.toUpperCase() && w.pin === pin.toUpperCase());
        if (found) {
          return { success: true, ownerPhone: user.phone, permissions: found.permissions || [] };
        }
      }
    }
    return { success: false };
  };

  const handleAddSubscriber = async (subscriber) => {
    resetActivity();
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
        trackWorkerUpdate('edit', subscriber.id, subscriber.name, subscriber.amper, subscriber.addedMonth + '_' + subscriber.addedYear, {
          name: subscriber.name,
          phone: subscriber.phone,
          amper: subscriber.amper,
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
        });
      }
    }
  };

  const handleDeleteSubscriber = async (id, monthKey) => {
    resetActivity();
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
          deletedByOwner: ownerName,
        };
      }
      return s;
    });
    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    if (userRole === 'worker' && sub) {
      trackWorkerUpdate('delete', id, sub.name, sub.amper, monthKey);
    }
  };

  const handleTogglePaid = async (id, monthKey) => {
    resetActivity();
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
    const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
    const sub = subscribers.find(s => s.id === id);
    const isCurrentlyPaid = sub && sub.paidMonths && sub.paidMonths[monthKey];
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
          ownerName: ownerName,
        });
        const partialPayments = s.partialPayments ? { ...s.partialPayments } : {};
        return { ...s, paidMonths, paymentHistory, partialPayments };
      }
      return s;
    });
    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    if (userRole === 'worker' && sub) {
      const monthPrice = getAmperPrice(amperPrices, monthKey);
      const amperVal = getAmperForMonth(sub, parseInt(monthKey.split('_')[0]), parseInt(monthKey.split('_')[1]));
      const amount = amperVal * monthPrice;
      trackWorkerUpdate(isCurrentlyPaid ? 'cancelled' : 'paid', id, sub.name, sub.amper, monthKey, { amount });
    }
  };

  const handlePartialPayment = async (id, amount, monthKey) => {
    resetActivity();
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s*[صم]$/, '');
    const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
    const sub = subscribers.find(s => s.id === id);

    const newSubs = subscribers.map(s => {
      if (s.id === id) {
        const partialPayments = s.partialPayments ? { ...s.partialPayments } : {};
        const monthPayments = partialPayments[monthKey] ? [...partialPayments[monthKey]] : [];
        monthPayments.push({
          amount: amount,
          timestamp,
          date: now.toISOString(),
          ownerName: ownerName,
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
            ownerName: ownerName,
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
  };

  const handleRestoreSubscriber = async (id) => {
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
        const latestEntry = amperHistory[amperHistory.length - 1];
        return { ...s, amper: latestEntry.amper, amperHistory };
      }
      return s;
    });
    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    if (userRole === 'worker' && sub) {
      trackWorkerUpdate('edit', id, sub.name, newAmper, monthKey, { amper: newAmper });
    }
  };

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
        onBack={() => setScreen('welcome')}
        onRegister={() => setScreen('login')}
      />
    );
  }

  if (screen === 'login') {
    return (
      <LoginScreen
        onBack={() => setScreen('welcome')}
        onRegister={() => setScreen('register')}
        onLogin={handleLogin}
      />
    );
  }

  if (screen === 'workerLogin') {
    return (
      <WorkerLoginScreen
        onBack={() => setScreen('welcome')}
        onLogin={async (code, pin) => {
          const result = await handleWorkerLogin(code, pin);
          if (result.success) {
            setWorkerOwnerPhone(result.ownerPhone);
            setUserRole('worker');
            setWorkerPermissions(result.permissions);
            setWorkerCode(code.toUpperCase());
            setCurrentUser(result.ownerPhone);
            setScreen('workerMain');
          }
          return result;
        }}
      />
    );
  }

  if (screen === 'workerMain') {
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
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
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
        onApplyUpdates={handleApplyUpdates}
      />
      <WorkerUpdatesModal
        visible={updatesModalVisible}
        onClose={() => setUpdatesModalVisible(false)}
        updates={pendingWorkerUpdates}
        onApplyUpdates={handleApplyUpdates}
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
  },
  loginContent: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
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
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 12,
  },
  loginCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
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
    paddingVertical: 16,
    fontSize: 16,
    color: '#333',
  },
  loginButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
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
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
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
    fontSize: 16,
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
    justifyContent: 'flex-end',
  },
  pickerContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    maxHeight: '60%',
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
    fontSize: 22,
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
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    lineHeight: 16,
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
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
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
    gap: 12,
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
    fontSize: 16,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'right',
  },
  subscriberAmperTag: {
    fontSize: 13,
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
    fontSize: 15,
    color: '#666',
    textAlign: 'right',
  },
  amperBlue: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
  payCheckbox: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxPaid: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxUnpaid: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#ccc',
    backgroundColor: 'white',
  },
  checkEmoji: {
    fontSize: 30,
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
    flexDirection: 'row',
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
    fontSize: 22,
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
    flexDirection: 'row',
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
    flexDirection: 'row',
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
    padding: 20,
    width: '90%',
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
    fontSize: 22,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  partialInput: {
    borderWidth: 2,
    borderColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    fontSize: 20,
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
    paddingHorizontal: 16,
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
    fontSize: 22,
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
    paddingHorizontal: 16,
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
    padding: 16,
    alignItems: 'center',
    minHeight: 90,
    justifyContent: 'center',
    width: '31%',
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
    fontSize: 28,
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
    fontSize: 13,
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
    backgroundColor: '#FFF3E0',
  },
  requiredNumber: {
    color: '#FF9800',
  },
  requiredLabel: {
    color: '#FF9800',
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
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
  },
  summaryValue: {
    fontSize: 17,
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
    fontSize: 18,
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
    width: 90,
  },
  expenseLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
  },
  expenseInput: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
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
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
  },
  netExpectedValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
  },
  netExpectedValueNegative: {
    color: '#D32F2F',
  },
  bottomButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 30,
    gap: 12,
  },
  showSubscribersButton: {
    backgroundColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: 24,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 2,
    justifyContent: 'center',
  },
  showSubscribersText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  reportsButton: {
    borderWidth: 2,
    borderColor: '#2196F3',
    borderRadius: 25,
    paddingHorizontal: 24,
    paddingVertical: 14,
    flex: 1,
    alignItems: 'center',
  },
  reportsButtonText: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: '700',
  },
});
