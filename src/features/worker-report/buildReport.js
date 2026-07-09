import { Linking, Alert } from 'react-native';

function buildWorkerReportMessage(workerUpdates, subscribers, amperPrices, goldenPrices, getAmperForMonth, getPriceForSubscriber, formatNumber, generatorName, workerName) {
  var paidCount = 0;
  var paidAmount = 0;
  var cancelledCount = 0;
  var partialCount = 0;
  var partialAmount = 0;
  var addedCount = 0;
  var deletedCount = 0;
  var editedCount = 0;
  var restoredCount = 0;
  var expenseItems = [];

  for (var u of workerUpdates) {
    if (u.type === 'paid') {
      paidCount++;
      var pSub = subscribers.find(function(s) { return s.id === u.subscriberId; });
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
      expenseItems.push({
        type: u.details && u.details.expenseType || '',
        amount: parseFloat(u.details && u.details.amount || 0)
      });
    }
  }

  var lines = [];
  var workerLabel = workerName || 'العامل';
  var genLabel = generatorName || 'المولد';
  lines.push('تقرير تحديثات العامل');
  lines.push('المولد: ' + genLabel);
  lines.push('العامل: ' + workerLabel);
  lines.push('');

  if (paidAmount > 0 || partialAmount > 0) {
    var totalCollected = paidAmount + partialAmount;
    lines.push('تم استيفاء ' + formatNumber(totalCollected) + ' د.ع من المشتركين');
  }

  if (expenseItems.length > 0) {
    var totalExpenses = 0;
    for (var e of expenseItems) {
      lines.push('تم اضافة صرفية ' + e.type + ' بمبلغ ' + formatNumber(e.amount) + ' د.ع');
      totalExpenses += e.amount;
    }
  }

  lines.push('');
  lines.push('تفاصيل التحديثات:');

  if (paidCount > 0) lines.push('- تم دفع لـ ' + paidCount + ' مشتركين');
  if (cancelledCount > 0) lines.push('- تم الغاء دفع ' + cancelledCount + ' مشتركين');
  if (partialCount > 0) lines.push('- تم دفع جزئي لـ ' + partialCount + ' مشتركين بمبلغ ' + formatNumber(partialAmount) + ' د.ع');
  if (addedCount > 0) lines.push('- تم اضافة ' + addedCount + ' مشتركين');
  if (editedCount > 0) lines.push('- تم التعديل على ' + editedCount + ' مشتركين');
  if (deletedCount > 0) lines.push('- تم حذف ' + deletedCount + ' مشتركين');
  if (restoredCount > 0) lines.push('- تم استعادة ' + restoredCount + ' مشتركين');

  if (lines.length <= 4) lines.push('لا توجد تحديثات');

  return lines.join('\n');
}

function promptSendWorkerReport(workerUpdates, subscribers, amperPrices, goldenPrices, getAmperForMonth, getPriceForSubscriber, formatNumber, ownerPhone, generatorName, workerName) {
  var msg = buildWorkerReportMessage(workerUpdates, subscribers, amperPrices, goldenPrices, getAmperForMonth, getPriceForSubscriber, formatNumber, generatorName, workerName);
  Alert.alert('ارسال تقرير للمالك', 'هل تريد ارسال تفاصيل التحديثات الى صاحب المولد عبر الواتساب؟', [
    { text: 'تخطي', style: 'cancel' },
    {
      text: 'ارسال ✓',
      onPress: function() {
        if (ownerPhone) {
          Linking.openURL('https://wa.me/' + ownerPhone + '?text=' + encodeURIComponent(msg)).catch(function() {});
        }
      }
    }
  ]);
}

module.exports = { buildWorkerReportMessage, promptSendWorkerReport };
