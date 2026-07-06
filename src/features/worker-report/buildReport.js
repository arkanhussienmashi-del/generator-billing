import { Linking, Alert } from 'react-native';

function buildWorkerReportMessage(batch, newSubs, amperPrices, goldenPrices, getAmperForMonth, getPriceForSubscriber, formatNumber) {
  var paidCount = 0;
  var paidAmount = 0;
  var cancelledCount = 0;
  var partialCount = 0;
  var partialAmount = 0;
  var addedCount = 0;
  var deletedCount = 0;
  var editedCount = 0;
  var restoredCount = 0;
  var expenseCount = 0;
  var expenseAmount = 0;
  var expenseTypes = [];

  for (var u of batch.updates) {
    if (u.type === 'paid') {
      paidCount++;
      var pSub = newSubs.find(function(s) { return s.id === u.subscriberId; });
      if (pSub) {
        var pmParts = u.monthKey.split('_');
        paidAmount += getAmperForMonth(pSub, parseInt(pmParts[0]), parseInt(pmParts[1])) * getPriceForSubscriber(amperPrices, goldenPrices, u.monthKey, pSub.subscriptionType);
      }
    } else if (u.type === 'cancelled') {
      cancelledCount++;
    } else if (u.type === 'partialPayment') {
      partialCount++;
      partialAmount += parseFloat(u.details && u.details.amount || 0);
    } else if (u.type === 'add') {
      addedCount++;
    } else if (u.type === 'delete') {
      deletedCount++;
    } else if (u.type === 'edit') {
      editedCount++;
    } else if (u.type === 'restore') {
      restoredCount++;
    } else if (u.type === 'addExpense') {
      expenseCount++;
      expenseAmount += parseFloat(u.details && u.details.amount || 0);
      if (u.details && u.details.expenseType) expenseTypes.push(u.details.expenseType);
    }
  }

  var workerLabel = batch.workerName || 'العامل';
  var msgLines = ['تقرير تحديثات العامل: ' + workerLabel, ''];
  if (paidCount > 0) msgLines.push('تم جباية مبلغ ' + formatNumber(paidAmount) + ' د.ع من ' + paidCount + ' مشتركين');
  if (cancelledCount > 0) msgLines.push('تم إلغاء دفع ' + cancelledCount + ' مشتركين');
  if (partialCount > 0) msgLines.push('تم دفع جزئي لمبلغ ' + formatNumber(partialAmount) + ' د.ع (' + partialCount + ' مشتركين)');
  if (addedCount > 0) msgLines.push('تم إضافة ' + addedCount + ' مشتركين جدد');
  if (deletedCount > 0) msgLines.push('تم حذف ' + deletedCount + ' مشتركين');
  if (editedCount > 0) msgLines.push('تم تعديل بيانات ' + editedCount + ' مشتركين');
  if (restoredCount > 0) msgLines.push('تم استعادة ' + restoredCount + ' مشتركين');
  if (expenseCount > 0) msgLines.push('تم إضافة صرفية ' + expenseTypes.join(' + ') + ' بمبلغ ' + formatNumber(expenseAmount) + ' د.ع');
  if (msgLines.length <= 2) msgLines.push('لا توجد تغييرات');

  return msgLines.join('\n');
}

function promptSendWorkerReport(batch, newSubs, amperPrices, goldenPrices, getAmperForMonth, getPriceForSubscriber, formatNumber, ownerPhone) {
  var msg = buildWorkerReportMessage(batch, newSubs, amperPrices, goldenPrices, getAmperForMonth, getPriceForSubscriber, formatNumber);
  Alert.alert('إرسال تقرير', 'هل تريد إرسال تقرير التحديثات عبر الواتساب؟', [
    { text: 'تخطي', style: 'cancel' },
    {
      text: 'إرسال ✓',
      onPress: function() {
        if (ownerPhone) {
          Linking.openURL('https://wa.me/' + ownerPhone + '?text=' + encodeURIComponent(msg)).catch(function() {});
        }
      }
    }
  ]);
}

module.exports = { buildWorkerReportMessage, promptSendWorkerReport };
