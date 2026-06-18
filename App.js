import React, { useState, useEffect } from 'react';
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

const DATA_DIR = FileSystem.documentDirectory + 'appdata/';

async function ensureDir() {
  const dir = await FileSystem.getInfoAsync(DATA_DIR);
  if (!dir.exists) {
    await FileSystem.makeDirectoryAsync(DATA_DIR, { intermediates: true });
  }
}

async function saveToFile(filename, data) {
  await ensureDir();
  const filePath = DATA_DIR + filename + '.json';
  await FileSystem.writeAsStringAsync(filePath, JSON.stringify(data));
}

async function loadFromFile(filename) {
  try {
    await ensureDir();
    const filePath = DATA_DIR + filename + '.json';
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(filePath);
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

async function deleteFile(filename) {
  try {
    const filePath = DATA_DIR + filename + '.json';
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) await FileSystem.deleteAsync(filePath);
  } catch (e) {}
}

async function saveUserData(phone, key, data) {
  await saveToFile(phone + '_' + key, data);
}

async function loadUserData(phone, key) {
  return await loadFromFile(phone + '_' + key);
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

const WelcomeScreen = ({ onLogin, onRegister }) => {
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
    if (!phone.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال رقم الهاتف أو الإيميل');
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

    const users = await loadFromFile('registered_users');
    const list = users || [];

    if (list.find(u => u.phone === phone.trim())) {
      Alert.alert('تنبيه', 'هذا الرقم أو الإيميل مسجل بالفعل');
      return;
    }

    const newUser = { phone: phone.trim(), password: password.trim() };
    list.push(newUser);
    await saveToFile('registered_users', list);

    await saveUserData(phone.trim(), 'generatorName', '');
    await saveUserData(phone.trim(), 'amperPrice', '0');
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
              placeholder="رقم الهاتف أو الإيميل"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
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

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال جميع البيانات');
      return;
    }

    const users = await loadFromFile('registered_users');
    const list = users || [];
    const user = list.find(u => u.phone === phone.trim() && u.password === password.trim());

    if (!user) {
      Alert.alert('تنبيه', 'رقم الهاتف أو كلمة المرور غير صحيحة');
      return;
    }

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
              placeholder="رقم الهاتف أو الإيميل"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
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

const SettingsScreen = ({ visible, onClose, generatorName, onSaveGeneratorName, ownerName, onSaveOwnerName }) => {
  const [name, setName] = useState(generatorName);
  const [owner, setOwner] = useState(ownerName);

  const handleSave = () => {
    onSaveGeneratorName(name);
    onSaveOwnerName(owner);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>الإعدادات</Text>
            <TouchableOpacity onPress={handleSave}>
              <Text style={styles.saveButtonText}>حفظ</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.settingsBody}>
              <Text style={styles.settingsLabel}>اسم المولد</Text>
              <TextInput
                style={styles.settingsInput}
                value={name}
                onChangeText={setName}
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
                onChangeText={setOwner}
                placeholder="أدخل اسم صاحب المولد"
                placeholderTextColor="#999"
                textAlign="right"
              />
              <Text style={styles.settingsHint}>سيتم عرض هذا الاسم عند كل عملية دفع أو إلغاء دفع</Text>
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
  const years = ['2024', '2025', '2026', '2027', '2028'];

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
    if (!name.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال اسم المشترك');
      return;
    }
    if (!amper.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال عدد الأمبيرات');
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
            <TextInput style={styles.formInput} value={amper} onChangeText={setAmper} placeholder="أدخل عدد الأمبيرات" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>رقم المشترك</Text>
            <TextInput style={styles.formInput} value={subscriberNumber} onChangeText={setSubscriberNumber} placeholder="أدخل رقم المشترك" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>رقم الجوزة</Text>
            <TextInput style={styles.formInput} value={meterNumber} onChangeText={setMeterNumber} placeholder="أدخل رقم الجوزة" placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
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

const EditSubscriberModal = ({ visible, onClose, subscriber, onSave, selectedMonth, selectedYear }) => {
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
    if (!name.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال اسم المشترك');
      return;
    }
    if (!amper.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال عدد الأمبيرات');
      return;
    }
    const amperVal = parseInt(amper) || 0;
    const updatedSubscriber = {
      ...subscriber,
      name: name.trim(),
      subscriberNumber: subscriberNumber.trim(),
      meterNumber: meterNumber.trim(),
      visaNumber: visaNumber.trim(),
    };
    if (amperVal !== subscriber.amper) {
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
            <TextInput style={styles.formInput} value={amper} onChangeText={setAmper} placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>رقم المشترك</Text>
            <TextInput style={styles.formInput} value={subscriberNumber} onChangeText={setSubscriberNumber} placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>رقم الجوزة</Text>
            <TextInput style={styles.formInput} value={meterNumber} onChangeText={setMeterNumber} placeholderTextColor="#999" keyboardType="numeric" textAlign="right" />
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

const PartialPaymentModal = ({ visible, onClose, subscriber, amperPrice, monthKey, onConfirm }) => {
  const [amount, setAmount] = useState('');
  const price = parseFloat(amperPrice) || 0;
  const pmMonth = monthKey ? monthKey.split('_')[0] : '1';
  const pmYear = monthKey ? monthKey.split('_')[1] : '2026';
  const totalDue = (subscriber ? getAmperForMonth(subscriber, pmMonth, pmYear) : 0) * price;
  const existingPayments = (subscriber && subscriber.partialPayments && subscriber.partialPayments[monthKey]) || [];
  const totalPaid = existingPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const remaining = totalDue - totalPaid;

  const handleConfirm = () => {
    const parsed = parseFloat(amount);
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
  };

  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
            <Text style={styles.modalTitle}>دفع جزئي</Text>
            <View style={{ width: 30 }} />
          </View>

          <View style={styles.partialSubscriberInfo}>
            <Text style={styles.partialSubscriberName}>{subscriber ? subscriber.name : ''}</Text>
            <Text style={styles.partialSubscriberAmper}>{subscriber ? subscriber.amper : 0} أميبر</Text>
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
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor="#999"
              keyboardType="numeric"
              textAlign="center"
            />
          </View>

          <TouchableOpacity style={styles.partialConfirmButton} onPress={handleConfirm}>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.partialConfirmText}>تأكيد الدفع</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const ChangeAmperModal = ({ visible, onClose, subscriber, selectedMonth, selectedYear, onConfirm }) => {
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

          <View style={styles.reportsSelectors}>
            <TouchableOpacity style={styles.reportsDropdown} onPress={() => setYearPickerVisible(true)}>
              <Text style={styles.reportsDropdownText}>{changeYear}</Text>
              <Ionicons name="calendar" size={20} color="#2196F3" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.reportsDropdown} onPress={() => setMonthPickerVisible(true)}>
              <Text style={styles.reportsDropdownText}>{changeMonth}</Text>
              <Ionicons name="calendar" size={20} color="#2196F3" />
            </TouchableOpacity>
          </View>

          <View style={styles.partialInputGroup}>
            <Text style={styles.partialInputLabel}>عدد الأمبيرات الجديد</Text>
            <TextInput
              style={styles.partialInput}
              value={newAmper}
              onChangeText={setNewAmper}
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

const SubscribersScreen = ({ visible, onClose, subscribers, onDeleteSubscriber, onSaveSubscriber, onTogglePaid, onPartialPayment, onRestoreSubscriber, amperPrice, currentUser, ownerName, onChangeAmper }) => {
  const [selectedMonth, setSelectedMonth] = useState('6');
  const [selectedYear, setSelectedYear] = useState('2026');
  const [searchText, setSearchText] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [addSubscriberVisible, setAddSubscriberVisible] = useState(false);
  const [partialPaymentVisible, setPartialPaymentVisible] = useState(false);
  const [partialPaymentSubscriber, setPartialPaymentSubscriber] = useState(null);
  const [changeAmperVisible, setChangeAmperVisible] = useState(false);
  const [changeAmperSubscriber, setChangeAmperSubscriber] = useState(null);
  const [editSubscriberVisible, setEditSubscriberVisible] = useState(false);
  const [editSubscriber, setEditSubscriber] = useState(null);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);

  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const monthKey = `${selectedMonth}_${selectedYear}`;
  const isPaid = (sub) => sub.paidMonths && sub.paidMonths[monthKey];

  const isVisibleForMonth = (sub, selMonth, selYear) => {
    const subMonth = sub.addedMonth ? parseInt(sub.addedMonth) : 1;
    const subYear = sub.addedYear ? parseInt(sub.addedYear) : 2026;
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

  const isDeletedForMonth = (sub, selMonth, selYear) => {
    if (!sub.deletedFromMonth) return false;
    const delParts = sub.deletedFromMonth.split('_');
    const delMonth = parseInt(delParts[0]);
    const delYear = parseInt(delParts[1]);
    return (selYear > delYear) || (selYear === delYear && selMonth >= delMonth);
  };

  const visibleSubscribers = subscribers.filter(sub => {
    return isVisibleForMonth(sub, parseInt(selectedMonth), parseInt(selectedYear));
  });

  const deletedForMonth = subscribers.filter(sub => {
    return isDeletedForMonth(sub, parseInt(selectedMonth), parseInt(selectedYear));
  });

  const visibleCount = visibleSubscribers.length;
  const paidCount = visibleSubscribers.filter(s => isPaid(s)).length;
  const unpaidCount = visibleSubscribers.filter(s => !isPaid(s)).length;
  const requiredCount = visibleSubscribers.filter(s => !isPaid(s)).length;

  const filters = [
    { id: 'total', label: 'الإجمالي اشتراك', count: visibleCount },
    { id: 'required', label: 'المشتركين المطلوبين', count: requiredCount },
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
    if (activeFilter === 'unpaid') return matchesSearch && !isPaid(sub);
    if (activeFilter === 'required') return matchesSearch && !isPaid(sub);
    return matchesSearch;
  });

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

          <View style={styles.subscriberButtonsRow}>
            <TouchableOpacity style={styles.deleteSubscriberButtonHalf} onPress={() => {
              if (filteredSubscribers.length === 0) {
                Alert.alert('تنبيه', 'لا يوجد مشتركين لحذفهم');
                return;
              }
              Alert.alert('حذف مشترك', 'اختر المشترك الذي تريد حذفه', filteredSubscribers.map(sub => ({
                text: sub.name,
                onPress: () => onDeleteSubscriber(sub.id, monthKey),
              })).concat([{ text: 'إلغاء', style: 'cancel' }]));
            }}>
              <Text style={styles.deleteSubscriberText}>حذف مشترك</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addSubscriberButtonHalf} onPress={() => setAddSubscriberVisible(true)}>
              <Text style={styles.addSubscriberText}>إضافة مشترك</Text>
            </TouchableOpacity>
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
                المحذوفين ({filters.find(f => f.id === 'deleted').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabPaid, activeFilter === 'paid' && styles.filterTabPaidActive]}
              onPress={() => setActiveFilter('paid')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'paid' && styles.activeFilterTabText]}>
                مدفوع ({filters.find(f => f.id === 'paid').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabUnpaid, activeFilter === 'unpaid' && styles.filterTabUnpaidActive]}
              onPress={() => setActiveFilter('unpaid')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'unpaid' && styles.activeFilterTabText]}>
                غير مدفوع ({filters.find(f => f.id === 'unpaid').count})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, styles.filterTabAll, activeFilter === 'all' && styles.filterTabAllActive]}
              onPress={() => setActiveFilter('all')}
            >
              <Text style={[styles.filterTabText, activeFilter === 'all' && styles.activeFilterTabText]}>
                الكل ({filters.find(f => f.id === 'all').count})
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
                      د.ع {formatNumber(getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear)) * (parseFloat(amperPrice) || 0))}    <Text style={styles.amperBlue}>{getAmperForMonth(subscriber, parseInt(selectedMonth), parseInt(selectedYear))} أميبر</Text>
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.restoreButton} onPress={() => onRestoreSubscriber(subscriber.id)}>
                    <Ionicons name="refresh" size={22} color="#4CAF50" />
                  </TouchableOpacity>
                </View>
              ))
            )
          ) : filteredSubscribers.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="mail-open-outline" size={80} color="#2196F3" />
              <Text style={styles.emptyStateText}>لا يوجد مشتركين</Text>
            </View>
          ) : (
            filteredSubscribers.map((subscriber) => {
              const monthKey = `${selectedMonth}_${selectedYear}`;
              const currentAmper = getAmperForMonth(subscriber, selectedMonth, selectedYear);
              const historyForMonth = (subscriber.paymentHistory || []).filter(h => h.monthKey === monthKey);
              const hasMultipleActions = historyForMonth.length > 1;
              const isExpanded = expandedCard === subscriber.id;
              const price = parseFloat(amperPrice) || 0;
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
                        <TouchableOpacity onPress={() => {
                          setEditSubscriber(subscriber);
                          setEditSubscriberVisible(true);
                        }}>
                          <Text style={styles.subscriberName}>{subscriber.name}</Text>
                        </TouchableOpacity>
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
                              setPartialPaymentSubscriber(subscriber);
                              setPartialPaymentVisible(true);
                            }}
                          >
                            <Ionicons name="wallet" size={22} color="#FF9800" />
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

                    {(isFullyPaid || historyForMonth.length > 0) && (
                      <View style={styles.cardBottomRow}>
                        <View style={styles.cardBottomLeft}>
                          {historyForMonth.length > 0 && historyForMonth[historyForMonth.length - 1].ownerName && (
                            <Text style={styles.paymentOwnerText}>{historyForMonth[historyForMonth.length - 1].ownerName}</Text>
                          )}
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
                            {historyForMonth.length > 0 ? historyForMonth[historyForMonth.length - 1].timestamp : 'مدفوع'}
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
        amperPrice={amperPrice}
        monthKey={monthKey}
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
      />

      <EditSubscriberModal
        visible={editSubscriberVisible}
        onClose={() => { setEditSubscriberVisible(false); setEditSubscriber(null); }}
        subscriber={editSubscriber}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        onSave={(updated) => onSaveSubscriber(updated)}
      />

      </View>
    </Modal>
  );
};

const ReportsScreen = ({ visible, onClose, subscribers, amperPrice }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedSubscriber, setSelectedSubscriber] = useState(null);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);

  const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const price = parseFloat(amperPrice) || 0;

  const filteredSubscribers = subscribers.filter(sub => {
    if (!sub.name.includes(searchText)) return false;
    if (sub.deletedFromMonth) {
      const delParts = sub.deletedFromMonth.split('_');
      const delYear = parseInt(delParts[1]);
      if (parseInt(selectedYear) > delYear) return false;
    }
    return true;
  });

  const monthsToShow = selectedMonth === 'all' ? months : [selectedMonth];

  let totalDue = 0;
  let totalPaid = 0;
  if (selectedSubscriber) {
    monthsToShow.forEach(m => {
      const monthKey = `${m}_${selectedYear}`;
      const isDeleted = isDeletedForReport(selectedSubscriber, m, selectedYear);
      if (isDeleted) return;
      const subAmper = getAmperForMonth(selectedSubscriber, m, selectedYear);
      totalDue += subAmper * price;
      if (selectedSubscriber.paidMonths && selectedSubscriber.paidMonths[monthKey]) {
        totalPaid += subAmper * price;
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
              <TextInput style={styles.searchInput} placeholder="ابحث عن مشترك..." placeholderTextColor="#999" value={searchText} onChangeText={setSearchText} textAlign="right" />
            </View>

            {searchText.length > 0 && !selectedSubscriber && (
              <View style={styles.searchResults}>
                {filteredSubscribers.map(sub => (
                  <TouchableOpacity key={sub.id} style={styles.searchResultItem} onPress={() => setSelectedSubscriber(sub)}>
                    <Text style={styles.searchResultName}>{sub.name}</Text>
                    <Text style={styles.searchResultAmper}>{sub.amper} أميبر</Text>
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
                  <TouchableOpacity onPress={() => setSelectedSubscriber(null)}>
                    <Ionicons name="close-circle" size={24} color="#D32F2F" />
                  </TouchableOpacity>
                </View>

                <View style={styles.reportSummary}>
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>المبلغ المطلوب</Text>
                    <Text style={styles.reportSummaryValue}>د.ع {formatNumber(totalDue)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>المدفوع</Text>
                    <Text style={[styles.reportSummaryValue, styles.reportSummaryPaid]}>د.ع {formatNumber(totalPaid)}</Text>
                  </View>
                  <View style={styles.reportSummaryDivider} />
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>المتبقي</Text>
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

                  return (
                    <View key={m} style={[styles.reportTableRow, isPaid ? styles.reportRowPaid : styles.reportRowUnpaid]}>
                      <Text style={styles.reportTableCell}>{m}/{selectedYear}</Text>
                      <Text style={[styles.reportTableCell, styles.amperBlue]}>{rowAmper}</Text>
                      <Text style={styles.reportTableCell}>د.ع {formatNumber(rowAmper * price)}</Text>
                      <View style={[styles.reportStatusBadge, isPaid ? styles.reportStatusPaid : styles.reportStatusUnpaid]}>
                        <Text style={styles.reportStatusText}>{isPaid ? 'مدفوع' : 'غير مدفوع'}</Text>
                      </View>
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

const MainScreen = ({ currentUser, generatorName, onOpenSettings, onShowSubscribers, onShowReports, subscribers, amperPrice, onSetAmperPrice, expenses, onSetExpenses, onLogout }) => {
  const [localAmperPrice, setLocalAmperPrice] = useState(amperPrice);
  const [gas, setGas] = useState(expenses.gas);
  const [oil, setOil] = useState(expenses.oil);
  const [repairs, setRepairs] = useState(expenses.repairs);
  const [salaries, setSalaries] = useState(expenses.salaries);

  useEffect(() => {
    setLocalAmperPrice(amperPrice);
    setGas(expenses.gas);
    setOil(expenses.oil);
    setRepairs(expenses.repairs);
    setSalaries(expenses.salaries);
  }, [amperPrice, expenses]);

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const currentMonthKey = `${currentMonth}_${currentYear}`;

  const totalSubscribers = subscribers.length;
  const totalAmper = subscribers.reduce((sum, sub) => sum + getAmperForMonth(sub, currentMonth, currentYear), 0);
  const paidCount = subscribers.filter(s => s.paidMonths && s.paidMonths[currentMonthKey]).length;
  const unpaidCount = subscribers.filter(s => !(s.paidMonths && s.paidMonths[currentMonthKey])).length;
  const price = parseFloat(localAmperPrice) || 0;
  const expectedAmount = totalAmper * price;
  const collectedAmount = subscribers.filter(s => s.paidMonths && s.paidMonths[currentMonthKey]).reduce((sum, sub) => sum + (getAmperForMonth(sub, currentMonth, currentYear) * price), 0);

  const totalExpenses = (parseFloat(gas) || 0) + (parseFloat(oil) || 0) +
    (parseFloat(repairs) || 0) + (parseFloat(salaries) || 0);
  const netExpected = collectedAmount - totalExpenses;

  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const getCurrentDate = () => {
    const now = new Date();
    return `${now.getMonth() + 1} / ${now.getFullYear()}`;
  };

  const handleAmperPriceChange = (val) => {
    setLocalAmperPrice(val);
    onSetAmperPrice(val);
  };

  const handleExpenseChange = (field, val) => {
    const newExpenses = { gas, oil, repairs, salaries, [field]: val };
    if (field === 'gas') setGas(val);
    if (field === 'oil') setOil(val);
    if (field === 'repairs') setRepairs(val);
    if (field === 'salaries') setSalaries(val);
    onSetExpenses(newExpenses);
  };

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor="#2196F3" barStyle="light-content" />
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
          <Text style={styles.priceLabel}>سعر الأميبر (د.ع)</Text>
          <TextInput style={styles.priceInput} value={localAmperPrice} onChangeText={handleAmperPriceChange} keyboardType="numeric" textAlign="center" />
        </View>

        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.totalCard]}>
            <Text style={[styles.statNumber, styles.totalNumber]}>{totalSubscribers}</Text>
            <Text style={[styles.statLabel, styles.totalLabel]}>المجموع</Text>
          </View>
          <View style={[styles.statCard, styles.amperCard]}>
            <Text style={[styles.statNumber, styles.amperNumber]}>{totalAmper}</Text>
            <View style={styles.amperLabelContainer}>
              <Text style={[styles.statLabel, styles.amperLabel]}>أميبر</Text>
              <Ionicons name="flash" size={14} color="#FF9800" />
            </View>
          </View>
          <View style={[styles.statCard, styles.paidCard]}>
            <Text style={[styles.statNumber, styles.paidNumber]}>{paidCount}</Text>
            <Text style={[styles.statLabel, styles.paidLabel]}>مدفوع</Text>
          </View>
          <View style={[styles.statCard, styles.unpaidCard]}>
            <Text style={[styles.statNumber, styles.unpaidNumber]}>{unpaidCount}</Text>
            <Text style={[styles.statLabel, styles.unpaidLabel]}>غير مدفوع</Text>
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
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="water" size={16} color="#2196F3" />
              <Text style={styles.expenseLabel}>كاز</Text>
            </View>
            <TextInput style={styles.expenseInput} value={gas} onChangeText={(v) => handleExpenseChange('gas', v)} keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" />
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="flask" size={16} color="#9C27B0" />
              <Text style={styles.expenseLabel}>دهن</Text>
            </View>
            <TextInput style={styles.expenseInput} value={oil} onChangeText={(v) => handleExpenseChange('oil', v)} keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" />
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="build" size={16} color="#FF5722" />
              <Text style={styles.expenseLabel}>إصلاحات</Text>
            </View>
            <TextInput style={styles.expenseInput} value={repairs} onChangeText={(v) => handleExpenseChange('repairs', v)} keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" />
          </View>
          <View style={styles.expenseRow}>
            <View style={styles.expenseLabelContainer}>
              <Ionicons name="people" size={16} color="#607D8B" />
              <Text style={styles.expenseLabel}>رواتب</Text>
            </View>
            <TextInput style={styles.expenseInput} value={salaries} onChangeText={(v) => handleExpenseChange('salaries', v)} keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" />
          </View>
        </View>

        <View style={styles.netExpectedContainer}>
          <Text style={styles.netExpectedLabel}>الصافي المتوقع:</Text>
          <Text style={styles.netExpectedValue}>د.ع {formatNumber(netExpected)}</Text>
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
  const [amperPrice, setAmperPrice] = useState('0');
  const [expenses, setExpenses] = useState({ gas: '0', oil: '0', repairs: '0', salaries: '0' });

  useEffect(() => {
    checkLoggedIn();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadAllUserData();
    }
  }, [currentUser]);

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
    const price = await loadUserData(currentUser, 'amperPrice');
    const subs = await loadUserData(currentUser, 'subscribers');
    const exp = await loadUserData(currentUser, 'expenses');
    if (name !== null) setGeneratorName(name);
    if (owner !== null) setOwnerName(owner);
    if (price !== null) setAmperPrice(price);
    if (subs !== null) setSubscribers(subs);
    if (exp !== null) setExpenses(exp);
  };

  const handleLogin = (userPhone) => {
    setCurrentUser(userPhone);
    setScreen('main');
  };

  const handleLogout = async () => {
    await deleteFile('current_user');
    setCurrentUser(null);
    setGeneratorName('');
    setAmperPrice('0');
    setSubscribers([]);
    setExpenses({ gas: '0', oil: '0', repairs: '0', salaries: '0' });
    setScreen('welcome');
  };

  const saveGeneratorName = async (name) => {
    setGeneratorName(name);
    if (currentUser) await saveUserData(currentUser, 'generatorName', name);
  };

  const saveOwnerName = async (name) => {
    setOwnerName(name);
    if (currentUser) await saveUserData(currentUser, 'ownerName', name);
  };

  const saveAmperPrice = async (price) => {
    setAmperPrice(price);
    if (currentUser) await saveUserData(currentUser, 'amperPrice', price);
  };

  const saveExpenses = async (exp) => {
    setExpenses(exp);
    if (currentUser) await saveUserData(currentUser, 'expenses', exp);
  };

  const handleAddSubscriber = async (subscriber) => {
    const existing = subscribers.find(s => s.id === subscriber.id);
    if (existing) {
      const newSubs = subscribers.map(s => s.id === subscriber.id ? subscriber : s);
      setSubscribers(newSubs);
      if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    } else {
      const duplicate = subscribers.find(s => s.name.trim() === subscriber.name.trim());
      if (duplicate) {
        Alert.alert('تنبيه', 'يوجد مشترك بنفس الاسم بالفعل');
        return;
      }
      const newSubs = [...subscribers, subscriber];
      setSubscribers(newSubs);
      if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
    }
  };

  const handleDeleteSubscriber = (id, monthKey) => {
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    const timestamp = `${dateStr} - ${timeStr} ${ampm}`;

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
    if (currentUser) saveUserData(currentUser, 'subscribers', newSubs);
  };

  const handleTogglePaid = async (id, monthKey) => {
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
    const newSubs = subscribers.map(s => {
      if (s.id === id) {
        const paidMonths = s.paidMonths ? { ...s.paidMonths } : {};
        const isCurrentlyPaid = paidMonths[monthKey];
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
        if (isCurrentlyPaid) {
          partialPayments[monthKey] = [];
        }
        return { ...s, paidMonths, paymentHistory, partialPayments };
      }
      return s;
    });
    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
  };

  const handlePartialPayment = async (id, amount, monthKey) => {
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'مساءً' : 'صباحاً';
    const dateStr = now.toLocaleDateString('ar-IQ', { dateStyle: 'medium' });
    const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    const timestamp = `${dateStr} - ${timeStr} ${ampm}`;
    const price = parseFloat(amperPrice) || 0;

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

        const totalDue = s.amper * price;
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
  };

  const handleRestoreSubscriber = async (id) => {
    const newSubs = subscribers.map(s => {
      if (s.id === id) {
        const restored = { ...s };
        delete restored.deletedFromMonth;
        return restored;
      }
      return s;
    });
    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
  };

  const handleChangeAmper = async (id, newAmper, monthKey) => {
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
        return { ...s, amper: newAmper, amperHistory };
      }
      return s;
    });
    setSubscribers(newSubs);
    if (currentUser) await saveUserData(currentUser, 'subscribers', newSubs);
  };

  if (screen === 'welcome') {
    return (
      <WelcomeScreen
        onLogin={() => setScreen('login')}
        onRegister={() => setScreen('register')}
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

  return (
    <View style={styles.mainContainer}>
      <MainScreen
        currentUser={currentUser}
        generatorName={generatorName}
        onOpenSettings={() => setSettingsVisible(true)}
        onShowSubscribers={() => setSubscribersVisible(true)}
        onShowReports={() => setReportsVisible(true)}
        subscribers={subscribers}
        amperPrice={amperPrice}
        onSetAmperPrice={saveAmperPrice}
        expenses={expenses}
        onSetExpenses={saveExpenses}
        onLogout={handleLogout}
      />
      <SettingsScreen
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        generatorName={generatorName}
        onSaveGeneratorName={saveGeneratorName}
        ownerName={ownerName}
        onSaveOwnerName={saveOwnerName}
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
        amperPrice={amperPrice}
        currentUser={currentUser}
        ownerName={ownerName}
      />
      <ReportsScreen
        visible={reportsVisible}
        onClose={() => setReportsVisible(false)}
        subscribers={subscribers}
        amperPrice={amperPrice}
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
    justifyContent: 'flex-end',
  },
  addSubscriberModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    maxHeight: '80%',
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
    flex: 3,
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
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 8,
  },
  filterTab: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
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
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
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
    color: '#1A1A1A',
    textAlign: 'right',
  },
  subscriberAmperTag: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '600',
    marginTop: 2,
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
    padding: 6,
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
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
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    minHeight: 90,
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
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
