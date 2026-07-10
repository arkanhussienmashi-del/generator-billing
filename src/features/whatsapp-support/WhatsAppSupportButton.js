import React from 'react';
import { TouchableOpacity, Text, Linking, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IS_SMALL = SCREEN_WIDTH < 360;
const IS_TABLET = SCREEN_WIDTH >= 768;

const WHATSAPP_NUMBER = '9647802524458';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('مرحباً، أحتاج مساعدة في تطبيق مولدي')}`;

const WhatsAppSupportButton = ({ style }) => {
  return (
    <TouchableOpacity
      style={[
        {
          backgroundColor: '#25D366',
          flexDirection: 'row-reverse',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: IS_SMALL ? 10 : IS_TABLET ? 14 : 12,
          borderRadius: 10,
          marginTop: IS_SMALL ? 16 : IS_TABLET ? 24 : 20,
          elevation: 3,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
        },
        style,
      ]}
      onPress={() => Linking.openURL(WHATSAPP_URL)}
      activeOpacity={0.8}
    >
      <Ionicons
        name="logo-whatsapp"
        size={IS_SMALL ? 18 : IS_TABLET ? 26 : 22}
        color="white"
        style={{ marginLeft: IS_SMALL ? 6 : IS_TABLET ? 10 : 8 }}
      />
      <Text
        style={{
          color: 'white',
          fontSize: IS_SMALL ? 13 : IS_TABLET ? 18 : 15,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        هل تحتاج مساعدة؟ تواصل مع الدعم
      </Text>
    </TouchableOpacity>
  );
};

export default WhatsAppSupportButton;
